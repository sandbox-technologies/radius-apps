export async function readPage(_input, context) {
  // The host resolves the captured invocation. No focus, tab ID, or URL fetching.
  const page = await context.host.call('tabs.read', {})
  return { title: page.title, url: page.url }
}
