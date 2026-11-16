# Reading Queue

An experimental interactive app with private state per instance. `add` saves
title/URL text supplied by the caller; `addSelectedPage` reads a captured tab's
title/URL; `list` reads the queue. It does not fetch, open, or execute saved URLs.
The bundle retains the upstream app ID `dev.radius.reading-queue` and version
`1.0.0` from the authored Radius v2 example.

## Local development

From this repository root:

```sh
pnpm app validate reading-queue
node --test apps/reading-queue/test/*.test.mjs
pnpm app build reading-queue
pnpm app install reading-queue
```

The install helper prints the local Radius command; it does not install, grant
permissions, or launch Radius. Follow [getting started](../../docs/getting-started.md)
for the separate user-controlled installation and instance setup. No native UI
is needed for validation, tests, or build.

## Requirements and state

- `queueState`: `storage.instance`, scoped to `{ "instance": "self" }`.
- `selectedPage`: `tabs.read`, scoped to
  `{ "target": "invocation", "fields": ["title", "url"] }`.

Only `addSelectedPage` requires `selectedPage`. Direct add/list need only
`queueState`. Create an instance explicitly with configuration such as
`{ "title": "Weekend reading" }`. Views and CLI invocations of that instance
read the same revisioned host state. Another instance has a separate queue.
Closing a view does not delete it. There are no schedules.

Writes use `storage.compareAndSet`; a revision conflict fails instead of
overwriting another writer. A successful commit emits `changed`. A failure to
emit can occur after the state is committed: inspect the run receipt and refresh
before deciding whether to retry. There is no automatic retry or rollback.
The queue is limited to 500 entries.

## View and captured targets

The view uses only `window.radiusApp.describe`, `invoke`, `getRun`, and `events`.
It renders untrusted metadata with `textContent`. It never reads the focused
browser tab, uses browser storage for state, or calls privileged Radius APIs.

The optional selected-page form needs a fresh context handle issued by the
host to that exact view caller. The view SDK cannot capture targets itself.
A CLI-issued handle cannot be pasted into the view to transfer authority.
Use the direct-entry form when no host target picker is available. A CLI caller
can explicitly capture and invoke within its own authenticated session; see
[permissions](../../docs/permissions.md).

## Verification status

Experimental, not native-verified. Tests execute the worker with local mock host
calls and the view with a minimal DOM/SDK double. They cover revisioned writes,
isolation, conflicts, partial effects, safe rendering, refresh, and errors.
They do not test the native sandbox, bridge injection, or captured-target lifetime.
See [testing](../../docs/testing.md) before claiming native readiness.

`screenshots` is intentionally empty: no verified native screenshot has been
captured, and a mock rendering would not be evidence of native operation.
`UNLICENSED` is a placeholder pending the owner's licensing decision; this
extraction grants no license and is not authorization to publish.
