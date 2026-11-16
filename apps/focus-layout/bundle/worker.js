export async function split(_input, context) {
  await context.host.call('tabs.split', { direction: 'right' })
  return { split: true }
}

export async function splitAndDraft(input, context) {
  await split({}, context)
  // Intended contract: the host must capture a separate draft destination.
  // This experimental build has no surface-bound create-if-empty draft primitive
  // and omits createDraft, so splitAndDraft is unavailable before admission.
  // Never substitute the new split pane, current focus, a raw tab ID, or send API.
  // Let errors propagate: the host receipt retains the committed split effect.
  await context.host.call('chat.createDraft', { text: input.text })
  return { split: true, draft: true }
}
