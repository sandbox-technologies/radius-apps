const sdk = window.radiusApp
const form = document.querySelector('#hello-form')
const button = document.querySelector('#greet')
const result = document.querySelector('#result')
let ready = false
let working = false
let closed = false

function report(error) {
  result.textContent = `${error.code ? `${error.code}: ` : ''}${error.message || String(error)}`
}

async function waitForResult(runId) {
  // This is a wait bound, not a UI animation or an input delay.
  const deadline = Date.now() + 125_000
  while (!closed && Date.now() < deadline) {
    const receipt = await sdk.getRun(runId)
    if (receipt.status === 'succeeded') return receipt.result
    if (['failed', 'cancelled', 'interrupted'].includes(receipt.status)) {
      throw new Error(`${receipt.error?.code || receipt.status}: inspect ${runId} before retrying; effects may have committed.`)
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Stopped waiting for ${runId}. This does not cancel the run; inspect its receipt before retrying.`)
}

window.addEventListener('pagehide', () => { closed = true })
form.addEventListener('submit', async event => {
  event.preventDefault()
  if (!ready || working || closed) return
  working = true
  button.disabled = true
  try {
    const admitted = await sdk.invoke('greet', { name: document.querySelector('#name').value })
    if (!admitted.id) throw new Error('Host did not return a run handle')
    result.textContent = `Waiting for ${admitted.id}…`
    const output = await waitForResult(admitted.id)
    // Names and results are untrusted data, never markup.
    if (!closed) result.textContent = output.message
  } catch (error) {
    if (!closed) report(error)
  } finally {
    working = false
    button.disabled = closed || !ready
  }
})

if (!sdk) {
  report(new Error('Open this installed view through Radius Apps; an ordinary browser has no app bridge.'))
} else {
  sdk.describe().then(description => {
    if (closed) return
    const unavailable = description.actions?.greet?.unavailable
    if (unavailable) throw new Error(`Greeting unavailable: ${unavailable}`)
    ready = true
    button.disabled = false
    result.textContent = 'Enter a name, then choose Say hello.'
  }).catch(report)
}
