// Each run reads host-owned state. Module globals are not a database.
function itemsFrom(value) {
  if (value === null) return []
  if (!value || !Array.isArray(value.items) || value.items.length > 500 ||
      value.items.some((item) => !item || typeof item.title !== 'string' || typeof item.url !== 'string')) {
    throw new Error('Queue state is invalid; refusing to overwrite it')
  }
  return value.items.map(({ title, url }) => ({ title, url }))
}

export async function list(_input, context) {
  const { revision, value } = await context.host.call('storage.read', {})
  return { revision, items: itemsFrom(value) }
}

export async function addSelectedPage(_input, context) {
  // The host resolves the captured invocation handle, never the current focus.
  const page = await context.host.call('tabs.read', {})
  return add(page, context)
}

export async function add(page, context) {
  const { revision, value } = await context.host.call('storage.read', {})
  const items = itemsFrom(value)
  if (items.length >= 500) throw new Error('This example queue is limited to 500 saved pages')
  items.push({ title: page.title, url: page.url })
  const committed = await context.host.call('storage.compareAndSet', {
    expectedRevision: revision,
    value: { items },
  })
  // If event delivery fails, propagate it. The receipt still records the committed
  // storage effect; do not blindly replay an invocation that may have saved data.
  await context.host.call('events.emit', { name: 'changed', payload: { revision: committed.revision } })
  return { revision: committed.revision }
}
