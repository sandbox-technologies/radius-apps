// A deterministic fixture renderer, not an agent or a live-data report.
// The host validates configuration and input against radius-app.json.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function invalid(message) {
  const error = new Error(message)
  error.code = 'INVALID_ARGUMENT'
  throw error
}

export async function generate(input, context) {
  const { title, timeZone } = context.metadata.configuration
  // The schema counts code points. Eighty points plus this fixed suffix fit
  // the host's 200 UTF-16-unit artifact-title limit even for astral characters.
  if (!title.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(title)) {
    invalid('Report title must contain visible text and no control characters')
  }
  const logicalTime = context.metadata.logicalTime
  // No wall clock, locale, randomness, run ID, or ambient browser state enters
  // the content. Time-zone validation/conversion belongs to the host scheduler;
  // this worker displays its configured label and the logical UTC instant.
  if (typeof logicalTime !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(logicalTime) ||
      !Number.isFinite(Date.parse(logicalTime)) ||
      new Date(logicalTime).toISOString() !== logicalTime) {
    invalid('A canonical UTC logicalTime from the host is required')
  }
  const {
    note = 'Bundled fixture data; no live sources were read.',
    items = [
      { label: 'Synthetic sample A', value: 3 },
      { label: 'Synthetic sample B', value: 5 },
      { label: 'Synthetic sample C', value: 8 },
    ],
  } = input
  const rows = items.map(item =>
    `<tr><th scope="row">${escapeHtml(item.label)}</th><td>${escapeHtml(item.value)}</td></tr>`,
  ).join('\n')
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)} — Synthetic report</title>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p><strong>Synthetic test data — not AI-generated.</strong></p>
<p>Scheduled Report Lab renders controlled fixtures only. It does not read activity, browse, call a provider, or generate a Morning Brief.</p>
<dl>
<dt>Logical run time (UTC)</dt><dd><time datetime="${escapeHtml(logicalTime)}">${escapeHtml(logicalTime)}</time></dd>
<dt>Configured scheduling time zone</dt><dd>${escapeHtml(timeZone)}</dd>
</dl>
<p>${escapeHtml(note)}</p>
<table>
<caption>Synthetic fixture values</caption>
<thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead>
<tbody>${rows || '<tr><td colspan="2">No synthetic rows supplied.</td></tr>'}</tbody>
<tfoot><tr><th scope="row">Synthetic total</th><td>${escapeHtml(total)}</td></tr></tfoot>
</table>
<p>Publication does not open this report. Opening a saved artifact is a separate host operation and does not regenerate it.</p>
</main>
</body>
</html>
`
  // Exactly one effect. Errors propagate; never retry an ambiguous publication
  // or substitute a fabricated artifact ID, provider, or automatic open.
  const { artifactId } = await context.host.call('artifacts.publish', {
    html,
    title: `${title} — Synthetic report`,
  })
  return { artifactId }
}
