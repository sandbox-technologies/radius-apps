const sdk = window.radiusApp
const status = document.querySelector('#status')
const items = document.querySelector('#items')
const controls = [...document.querySelectorAll('button')]
let working = false
let revision = -1
let cursor = 0
let stopped = false
let eventTimer

function report(error) {
  status.textContent = `${error.code ? `${error.code}: ` : ''}${error.message || String(error)}`
}

async function invoke(action, input, options = {}) {
  const admitted = await sdk.invoke(action, input, options)
  const runId = admitted.id
  if (!runId) throw new Error('Host did not return a run handle')
  status.textContent = `Run ${runId} admitted. Waiting for its receipt…`
  const deadline = Date.now() + 125_000
  while (Date.now() < deadline) {
    const run = await sdk.getRun(runId)
    if (run.status === 'succeeded') return run.result
    if (['failed', 'cancelled', 'interrupted'].includes(run.status)) {
      throw new Error(`${run.error?.code || run.status}: ${run.error?.message || 'Run did not complete'}. Inspect ${runId} before retrying; effects may have committed.`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Still waiting for ${runId}. The run was not cancelled; inspect its receipt before retrying.`)
}

async function refresh() {
  const queue = await invoke('list', {})
  revision = queue.revision
  const rows = queue.items.map((item) => {
    const row = document.createElement('li')
    const title = document.createElement('strong')
    const url = document.createElement('span')
    // Page metadata is untrusted. Text only: no HTML, navigation or network.
    title.textContent = item.title || 'Untitled page'
    url.textContent = item.url
    row.append(title, url)
    return row
  })
  items.replaceChildren(...rows)
  document.querySelector('#empty').hidden = rows.length > 0
  document.querySelector('#revision').textContent = `Revision ${queue.revision} · ${rows.length} saved ${rows.length === 1 ? 'page' : 'pages'}`
  status.textContent = 'Queue is up to date.'
}

async function busy(action) {
  if (working) return
  working = true
  controls.forEach((control) => { control.disabled = true })
  try { await action() } catch (error) { report(error) }
  finally { working = false; controls.forEach((control) => { control.disabled = false }) }
}

async function pollEvents() {
  if (stopped) return
  try {
    if (!working && document.visibilityState !== 'hidden') {
      const batch = await sdk.events(cursor)
      cursor = batch.sequence
      if (batch.gap || batch.events.some((event) => event.name === 'app.changed' && event.payload.revision > revision)) {
        await busy(refresh)
      }
    }
  } catch (error) {
    // Stop on revoked/expired bridges. Do not hide host errors or keep retrying.
    stopped = true
    report(error)
  }
  if (!stopped) eventTimer = setTimeout(pollEvents, 2000)
}

window.addEventListener('pagehide', () => { stopped = true; clearTimeout(eventTimer) })

document.querySelector('#refresh').addEventListener('click', () => busy(refresh))
document.querySelector('#add-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const title = document.querySelector('#page-title').value
  const url = document.querySelector('#page-url').value.trim()
  busy(async () => {
    await invoke('add', { title, url })
    document.querySelector('#add-form').reset()
    await refresh()
  })
})
document.querySelector('#save-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const contextHandle = document.querySelector('#context').value.trim()
  if (!contextHandle) { report(new Error('Choose a captured context handle first')); return }
  busy(async () => {
    await invoke('addSelectedPage', {}, { contextHandle })
    document.querySelector('#context').value = ''
    await refresh()
  })
})

if (!sdk) {
  controls.forEach((control) => { control.disabled = true })
  report(new Error('Open this view through Radius Apps. An ordinary browser has no app bridge.'))
} else {
  // Discovery grants no authority. Only admitted actions access state/targets.
  busy(async () => { await sdk.describe(); await refresh() }).then(pollEvents)
}
