// Only the public document-bound RadiusAppView surface is used here. Optional
// preview methods are feature-checked; there is no generic call/admin transport.
const ACTIVE = new Set(['queued', 'running', 'cancelling'])
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])
const REQUIRED = ['activity', 'generation', 'reports']
const POLL_INTERVAL_MS = 1000
const WATCH_LIMIT_MS = 125_000 // A checking bound, never a budget or cancellation.

const text = (value, fallback = 'Not supplied') => typeof value === 'string' && value.length > 0 ? value : fallback
const code = error => text(error?.code, 'HOST_ERROR')
const invalid = () => Object.assign(new Error('Unexpected public host response'), { code: 'INVALID_HOST_RESPONSE' })
const newest = rows => [...rows].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))

export function mountMorningBrief({ document, window, now = () => Date.now() }) {
  const sdk = window.radiusApp
  const ids = ['availability', 'availability-badge', 'run-now', 'refresh', 'notice', 'capabilities',
    'run-status', 'run-message', 'receipt', 'effects', 'check-run', 'cancel-run', 'stop-checking',
    'cancel-help', 'runs-note', 'runs', 'artifacts-note', 'artifacts', 'artifact-status',
    'instance-note', 'configuration', 'schedule-note', 'schedules', 'identity',
    'host-generation', 'host-budget', 'receipt-budget']
  const ui = Object.fromEntries(ids.map(id => [id, document.querySelector(`#${id}`)]))
  let description = null
  let instance
  let runs = []
  let artifacts = []
  let selected = null
  let busy = false
  let closed = false
  let disconnected = false
  let admissionUnknown = false
  let checking = false
  let watchUntil = 0
  let timer
  // The app document is pinned to an exact URL. Even a fragment navigation
  // changes that identity, so in-page guidance scrolls/focuses without navigating.
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    link.addEventListener('click', event => {
      event.preventDefault()
      if (closed) return
      const target = document.querySelector(link.getAttribute('href'))
      target?.scrollIntoView({ behavior: 'auto', block: 'start' })
      target?.focus({ preventScroll: true })
    })
  }
  const has = method => typeof sdk?.[method] === 'function'
  const granted = name => description?.installation.grants.includes(name) === true
  const node = (tag, content) => {
    const element = document.createElement(tag)
    element.textContent = content
    return element
  }
  const facts = (element, pairs) => element.replaceChildren(...pairs.flatMap(([label, value]) => [node('dt', label), node('dd', String(value))]))

  function renderBudget(element, budget) {
    const tokens = budget?.maxTotalTokens
    const cost = budget?.maxCostUsd
    const unknown = 'Unknown (not reported)'
    facts(element, [
      ['Total token ceiling', Number.isSafeInteger(tokens) && tokens >= 0 ? tokens.toLocaleString('en-US') : unknown],
      ['Cost ceiling (USD)', typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
        ? `$${String(cost)} USD` : unknown],
    ])
  }

  function renderGeneration() {
    const generation = description?.generation
    const status = generation?.available === true ? 'Host generation is available.'
      : generation?.available === false ? 'Host generation is unavailable.'
        : 'Host generation availability is unknown (not reported by this host).'
    const reason = text(generation?.unavailable, generation?.available === false ? 'No reason was supplied.' : '')
    ui['host-generation'].textContent = `${status}${reason ? ` ${reason}` : ''} App grants are checked separately.`
    renderBudget(ui['host-budget'], generation?.usageBudget)
  }

  function generationBlock() {
    if (disconnected || !description) return 'Host availability is not confirmed. Open this installed view through Radius Apps.'
    if (!description.installation.enabled) return 'This installation is disabled. Review it in native Apps management.'
    if (description.generation?.available === false) return 'The host reports generation as unavailable; see its reason and required ceilings below. Grants cannot override this.'
    if (!description.actions.generate || description.actions.generate.unavailable !== null) {
      return `Generation unavailable: ${text(description.actions.generate?.unavailable, 'the host has not confirmed availability')}. No alternative runner will be used.`
    }
    const missing = REQUIRED.filter(name => !granted(name))
    if (missing.length) return `Generation needs separately approved grants: ${missing.join(', ')}. Review them in native Apps management.`
    if (!has('getInstance')) return 'This older host cannot display the bound instance configuration. Use native Apps management or an updated host.'
    if (!instance) return 'No confirmed bound instance. Explicitly create/select an instance in native Apps management; this view never creates one.'
    if (admissionUnknown) return 'An invocation outcome is unknown. Inspect native run history before attempting another run; this view will not replay it.'
    if (runs.some(run => ACTIVE.has(run.status)) || ACTIVE.has(selected?.status)) return 'A run is unfinished. Inspect its receipt or request cancellation before starting another.'
    return null
  }

  function syncControls() {
    if (closed) return
    const block = generationBlock()
    renderGeneration()
    ui['run-now'].disabled = busy || Boolean(block)
    ui.refresh.disabled = busy || disconnected || !has('describe')
    ui['check-run'].disabled = busy || disconnected || !selected
    ui['cancel-run'].disabled = busy || disconnected || !has('cancelRun') || !ACTIVE.has(selected?.status) || selected?.status === 'cancelling'
    ui['stop-checking'].disabled = !checking
    ui.availability.textContent = block || 'The host reports generate as available and its required grants are approved. Choose Run now to request one brief.'
    ui['availability-badge'].textContent = block ? 'Not ready to run' : 'Available on this host'
    ui['availability-badge'].dataset.tone = block ? 'warning' : 'success'
    ui['cancel-help'].textContent = has('cancelRun')
      ? 'Cancel requests host cancellation. Only a cancelled receipt confirms it; effects may already have committed.'
      : 'This older host has no app-view cancellation method. Use native Apps management to cancel; stopping checks is not cancellation.'
    for (const button of ui.runs.querySelectorAll('button')) button.disabled = busy || disconnected
    for (const button of ui.artifacts.querySelectorAll('button')) button.disabled = busy || disconnected || !has('openArtifact') || !granted('openReports')
  }

  function stopChecking(message) {
    checking = false
    window.clearTimeout(timer)
    timer = undefined
    if (!closed && message) ui['run-message'].textContent = message
    syncControls()
  }

  function fail(error, operation) {
    // Any failed observation stops automatic checks, including revocation. A
    // manual refresh may recover ordinary errors; no action is ever replayed.
    stopChecking()
    if (code(error) === 'CAPABILITY_UNAVAILABLE') description = null
    if (['PERMISSION_DENIED', 'REVOKED', 'INSTALLATION_REMOVED', 'STALE_VIEW'].includes(code(error))) {
      disconnected = true
      description = null
      instance = undefined
      artifacts = []
      runs = []
      ui.artifacts.replaceChildren()
      ui.runs.replaceChildren()
      ui.capabilities.replaceChildren()
      ui.configuration.replaceChildren()
      ui.schedules.replaceChildren()
      ui['instance-note'].textContent = 'Access changed. Reopen this view through native Apps management to inspect configuration.'
      ui['schedule-note'].textContent = 'Schedule state is no longer confirmed.'
      ui['artifacts-note'].textContent = 'Artifact access is no longer confirmed.'
      ui['runs-note'].textContent = 'Run history access is no longer confirmed.'
    }
    ui.notice.textContent = `${code(error)}: ${operation}. No automatic retry. Inspect the receipt/native management if an effect may have committed.`
  }

  async function operation(task) {
    if (closed || disconnected || busy) return
    busy = true
    ui.notice.textContent = ''
    syncControls()
    try { await task() }
    catch (error) { if (!closed) fail(error, 'The host operation did not complete reliably') }
    finally { busy = false; syncControls() }
  }

  async function discover() {
    // Forget old permission/availability data before asking the host again.
    description = null
    const next = await sdk.describe()
    if (closed) return
    if (next?.apiVersion !== 'radius.apps/1' || next.manifest?.id !== 'dev.radius.morning-brief' ||
        !Array.isArray(next.installation?.grants) || !next.actions) throw invalid()
    description = next
    const labels = [
      ['activity', 'Previous-day titles & timestamps'], ['generation', 'Restricted generation'],
      ['reports', 'Publish owned reports'], ['readReports', 'List saved reports · optional'],
      ['openReports', 'Open saved reports · optional'],
    ]
    ui.capabilities.replaceChildren(...labels.map(([name, label]) => {
      const row = document.createElement('li')
      row.append(node('strong', label), node('span', `${name}: ${granted(name) ? 'Approved' : 'Not approved'}`))
      return row
    }))
    facts(ui.identity, [['Installation', text(next.installation.id)], ['Release digest', text(next.installation.releaseDigest)]])
  }

  async function readInstance() {
    instance = undefined
    if (!has('getInstance')) {
      ui['instance-note'].textContent = 'Current instance values are unavailable on this older host. They are not inferred. Use native Apps management.'
      facts(ui.configuration, [['Title', 'Unavailable'], ['Timezone', 'Unavailable'], ['Today’s priorities', 'Unavailable']])
      return
    }
    const current = await sdk.getInstance()
    if (closed) return
    if (current !== null && (!current?.id || !current.configuration || typeof current.configuration !== 'object')) throw invalid()
    instance = current
    if (!current) {
      ui['instance-note'].textContent = 'No instance is bound. Create or select one explicitly in native Apps management; no instance was created here.'
      facts(ui.configuration, [['Title', 'No bound instance'], ['Timezone', 'No bound instance'], ['Today’s priorities', 'No bound instance']])
      return
    }
    ui['instance-note'].textContent = 'Current saved configuration, read-only here. An already admitted run keeps its own configuration snapshot.'
    facts(ui.configuration, [
      ['Instance', current.id], ['Configuration revision', current.configurationRevision],
      ['Title', text(current.configuration.title)], ['Timezone', text(current.configuration.timeZone)],
      ['Today’s priorities', text(current.configuration.todayPriorities, 'Not set (optional)')],
    ])
  }

  function renderRuns() {
    ui.runs.replaceChildren(...newest(runs).map(run => {
      const row = document.createElement('li')
      const button = node('button', 'View receipt')
      button.type = 'button'
      button.addEventListener('click', () => operation(async () => {
        stopChecking()
        const receipt = await sdk.getRun(run.id)
        if (closed) return
        acceptReceipt(receipt, run.id)
        startChecking()
      }))
      row.append(node('strong', `${text(run.action)} · ${text(run.status)}`), node('code', run.id), node('span', `Created ${text(run.createdAt)}`), button)
      return row
    }))
  }

  function acceptReceipt(receipt, expectedId) {
    if (typeof receipt?.id !== 'string' || !receipt.id || (expectedId && receipt.id !== expectedId) || receipt.action !== 'generate' ||
        (!ACTIVE.has(receipt.status) && !TERMINAL.has(receipt.status)) || !Array.isArray(receipt.effects)) throw invalid()
    selected = receipt
    runs = [receipt, ...runs.filter(run => run.id !== receipt.id)]
    ui['run-status'].textContent = receipt.status
    ui['run-status'].dataset.tone = receipt.status === 'succeeded' ? 'success' : 'neutral'
    const messages = {
      queued: 'Admitted and queued. No result is available yet.',
      running: 'The host reports this run is running. No percentage estimate is available.',
      cancelling: 'Cancellation is in progress, not confirmed. Already committed effects remain.',
      succeeded: 'The host reports success. Publication is separate from opening; no report was opened by this view.',
      failed: 'The run failed. Inspect the error code and effects before explicitly trying again; committed effects were not rolled back.',
      cancelled: 'The host confirms cancellation. Already committed effects were not rolled back.',
      interrupted: 'The run was interrupted. Inspect effects before explicitly trying again; the outcome may be partial.',
    }
    ui['run-message'].textContent = messages[receipt.status]
    const pairs = [['Run ID', receipt.id], ['Instance', text(receipt.instanceId)], ['Created', text(receipt.createdAt)],
      ['Deadline', text(receipt.deadline)], ['Finished', text(receipt.finishedAt, 'Not finished')]]
    if (receipt.error?.code) pairs.push(['Error code', text(receipt.error.code)])
    if (receipt.status === 'succeeded') pairs.push(['Artifact ID', text(receipt.result?.artifactId, 'Missing from success receipt — inspect native management')])
    facts(ui.receipt, pairs)
    renderBudget(ui['receipt-budget'], receipt.usageBudget)
    ui.effects.replaceChildren(...receipt.effects.map(effect => node('li', `${text(effect.method)} — ${text(effect.status)} · ${text(effect.at)}`)))
    if (!receipt.effects.length) ui.effects.append(node('li', 'No effects are recorded in this receipt. This is not a rollback guarantee.'))
    renderRuns()
    if (TERMINAL.has(receipt.status)) stopChecking()
  }

  async function readRuns() {
    if (!has('listRuns')) {
      ui['runs-note'].textContent = 'This older host cannot list run history. Only receipts observed in this open view are shown; native management has the full history.'
      renderRuns()
      return
    }
    const list = await sdk.listRuns()
    if (closed) return
    if (!Array.isArray(list)) throw invalid()
    runs = list.filter(run => run.action === 'generate')
    // Refresh a selected snapshot too: a now-terminal run must not leave an
    // old queued/running receipt indefinitely blocking the controls.
    // History is metadata, not a complete receipt (no result/effects assumed).
    if (selected && runs.some(run => run.id === selected.id)) {
      const id = selected.id
      const receipt = await sdk.getRun(id)
      if (closed) return
      acceptReceipt(receipt, id)
    }
    ui['runs-note'].textContent = runs.length ? 'Host-provided run metadata for this bound instance. Select one to fetch its current receipt.' : 'The host returned no recent runs for this bound instance.'
    renderRuns()
  }

  async function readArtifacts() {
    artifacts = []
    ui.artifacts.replaceChildren()
    if (!has('listArtifacts')) {
      ui['artifacts-note'].textContent = 'This older host cannot list saved artifacts in an app view. Review them in native Apps management; no empty-history claim is made.'
      return
    }
    if (!granted('readReports')) {
      ui['artifacts-note'].textContent = 'Saved reports have not been read. Approve readReports (artifacts.read, owner: self) separately in native management if wanted.'
      return
    }
    const list = await sdk.listArtifacts()
    if (closed) return
    if (!Array.isArray(list)) throw invalid()
    artifacts = newest(list)
    ui['artifacts-note'].textContent = artifacts.length
      ? `Host-provided saved reports. ${granted('openReports') ? 'Open only the report you choose.' : 'Opening requires the separate openReports grant.'}${has('openArtifact') ? '' : ' This older host cannot open artifacts from an app view; use native management.'}`
      : 'The host returned no saved reports for this bound instance. Nothing was generated to fill this list.'
    ui.artifacts.replaceChildren(...artifacts.map(artifact => {
      const row = document.createElement('li')
      const button = node('button', 'Open report')
      button.type = 'button'
      button.addEventListener('click', () => operation(async () => {
        if (!has('openArtifact') || !granted('openReports')) return
        // Recheck grants immediately before the explicit open, not on the basis
        // of an old list. The host remains responsible for effect-time checks.
        await discover()
        if (closed) return
        if (!granted('openReports') || !granted('readReports')) {
          await readArtifacts()
          ui['artifact-status'].textContent = 'Report not opened: required report access changed. Review grants in native Apps management.'
          return
        }
        await sdk.openArtifact(artifact.id)
        if (!closed) ui['artifact-status'].textContent = `The host accepted the open request for ${artifact.id}. Generation was not invoked.`
      }))
      row.append(node('strong', text(artifact.title, 'Untitled report')), node('span', `Created ${text(artifact.createdAt)}`),
        node('code', text(artifact.id)), node('span', `Run ${text(artifact.runId)}`), button)
      return row
    }))
  }

  async function readTriggers() {
    ui.schedules.replaceChildren()
    if (!has('listTriggers')) {
      ui['schedule-note'].textContent = 'The manifest suggests 08:30, not an enabled schedule. This older host cannot report actual bindings here; use native management.'
      return
    }
    const bindings = await sdk.listTriggers()
    if (closed) return
    if (!Array.isArray(bindings)) throw invalid()
    ui['schedule-note'].textContent = bindings.length
      ? 'Actual host bindings, read-only. Configuration edits disable existing bindings until you explicitly reapprove them in native management.'
      : 'No bindings were returned for this bound instance. 08:30 is only a suggestion; nothing was enabled here.'
    ui.schedules.replaceChildren(...bindings.map(binding => {
      const row = document.createElement('li')
      row.append(node('strong', `${text(binding.trigger)} · ${binding.enabled ? 'Enabled' : 'Disabled'}`),
        node('span', `${text(binding.localTime, 'Time not supplied')} · ${text(binding.timeZone, 'Timezone not supplied')}`),
        node('span', `Delivery: ${text(binding.delivery)} · revision ${binding.revision}`), node('code', text(binding.id)))
      return row
    }))
  }

  async function refresh() {
    await discover()
    if (closed) return
    await readInstance()
    if (closed) return
    await readRuns()
    if (closed) return
    await readTriggers()
    if (closed) return
    await readArtifacts()
  }

  function scheduleCheck() {
    if (!checking || closed) return
    timer = window.setTimeout(async () => {
      timer = undefined
      if (closed || !checking) return
      if (now() >= watchUntil) {
        stopChecking('Stopped checking after the local wait limit. The run was NOT cancelled. Choose Check receipt or inspect native management; do not assume failure or replay it.')
        return
      }
      if (!busy && document.visibilityState !== 'hidden') await operation(async () => {
        const id = selected.id
        const receipt = await sdk.getRun(id)
        if (closed) return
        acceptReceipt(receipt, id)
        if (TERMINAL.has(receipt.status)) {
          await discover()
          if (!closed) await readArtifacts()
        }
      })
      scheduleCheck()
    }, POLL_INTERVAL_MS)
  }

  function startChecking() {
    stopChecking()
    if (closed || !ACTIVE.has(selected?.status)) return
    checking = true
    watchUntil = now() + WATCH_LIMIT_MS
    scheduleCheck()
    syncControls()
  }

  ui.refresh.addEventListener('click', () => operation(refresh))
  ui['run-now'].addEventListener('click', () => {
    if (generationBlock()) return
    return operation(async () => {
      // Admission uses freshly discovered availability and instance metadata.
      // No input/configuration/grant/schedule mutation is hidden in this call.
      await discover()
      if (closed) return
      await readInstance()
      if (closed) return
      await readRuns()
      if (closed || generationBlock()) return
      try {
        const receipt = await sdk.invoke('generate', {})
        if (closed) return
        acceptReceipt(receipt)
        startChecking()
        if (TERMINAL.has(receipt.status)) await readArtifacts()
      } catch (error) {
        // A missing/malformed response may follow successful admission. Never
        // create a second run automatically to recover an absent receipt.
        if (!['CAPABILITY_UNAVAILABLE', 'PERMISSION_DENIED', 'INVALID_ARGUMENT'].includes(code(error))) admissionUnknown = true
        throw error
      }
    })
  })
  ui['check-run'].addEventListener('click', () => operation(async () => {
    if (!selected) return
    const id = selected.id
    const receipt = await sdk.getRun(id)
    if (closed) return
    acceptReceipt(receipt, id)
    startChecking()
    if (TERMINAL.has(receipt.status)) {
      await discover()
      if (!closed) await readArtifacts()
    }
  }))
  ui['cancel-run'].addEventListener('click', () => operation(async () => {
    if (!has('cancelRun') || !ACTIVE.has(selected?.status) || selected.status === 'cancelling') return
    const id = selected.id
    stopChecking()
    await sdk.cancelRun(id)
    if (closed) return
    ui['run-message'].textContent = 'Cancellation requested. Checking the host receipt; cancellation is not yet confirmed.'
    const receipt = await sdk.getRun(id)
    if (closed) return
    acceptReceipt(receipt, id)
    startChecking()
  }))
  ui['stop-checking'].addEventListener('click', () => stopChecking('Checking paused by you. The run was NOT cancelled. Choose Check receipt to resume observation.'))
  window.addEventListener('pagehide', () => {
    closed = true
    stopChecking()
  })

  renderBudget(ui['receipt-budget'], undefined)
  const ready = (async () => {
    if (['describe', 'invoke', 'getRun', 'events'].some(method => !has(method))) {
      disconnected = true
      ui.notice.textContent = 'CAPABILITY_UNAVAILABLE: Open this installed view through Radius Apps. An ordinary browser has no app bridge; no sample data or generation fallback is provided.'
      ui['instance-note'].textContent = 'No host configuration was read.'
      ui['runs-note'].textContent = 'No run history was read.'
      ui['artifacts-note'].textContent = 'No saved reports were read.'
      syncControls()
      return
    }
    await operation(refresh)
  })()
  return { ready }
}
