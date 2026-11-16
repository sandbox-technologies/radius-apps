# Focus Layout

An experimental, stateless action app. `split` requests a right-hand split of a
captured tab. `splitAndDraft` declares a future split-then-unsent-draft contract.
There is no view, instance storage, schedule, message submission, or agent call.
The bundle retains `dev.radius.focus-layout` version `1.0.0`.

## Current limitation

**`splitAndDraft` is blocked on the current experimental native host.** That
host lacks a verified, separately captured, surface-bound create-if-empty draft
primitive. Admission must fail with `CAPABILITY_UNAVAILABLE` before splitting.
The worker is not an alternative way to authorize that action. Do not replace
its target with current focus, the new pane, or a raw tab ID.

`split` is the intended split-only path. This repository has not verified its
native execution; passing mock tests does not establish native readiness.

## Local development

```sh
pnpm app validate focus-layout
node --test apps/focus-layout/test/*.test.mjs
pnpm app build focus-layout
pnpm app install focus-layout
```

Run these from the repository root. The install helper only prints a command;
it does not launch Radius or approve anything. User-controlled installation and
captured-context usage are described in [permissions](../../docs/permissions.md).

## Contract

- `layout`: `tabs.layout`, exactly `{ "target": "invocation" }`.
- `draft`: `chat.draft`, exactly `{ "target": "invocation" }`.
- `split` requires only `layout`; `splitAndDraft` requires both.
- Both actions declare the `tab` context; neither assumes current focus.

`split` calls `context.host.call('tabs.split', { direction: 'right' })`.
The future draft path then calls `chat.createDraft` with caller-supplied text;
it never sends that text. If a future host admits the action but draft creation
subsequently fails, an already committed split remains in the run's effects.
There is no claimed rollback and no automatic replay. Inspect the receipt.

Tests execute both worker exports against local doubles, including a hypothetical
future draft port, denial, and partial effects. They do not demonstrate that
native draft support exists or verify the host's pre-admission rejection.

`screenshots` is empty because native capture has not been performed. No mock
screenshot is presented as native evidence. `UNLICENSED` remains a licensing
placeholder; no publication or license grant is implied.
