# Morning Brief: local public-SDK view example

The installed example is [ui/index.html](bundle/ui/index.html),
[ui/styles.css](bundle/ui/styles.css), [ui/app.js](bundle/ui/app.js), and
[ui/view.js](bundle/ui/view.js). The tiny entry mounts the real controller;
[view.test.mjs](test/view.test.mjs) mounts that same controller with trusted
DOM/SDK doubles. No build tool or dependency is needed at app runtime.

Start with the [vendored public view declarations](../../vendor/apps-sdk/view.d.ts),
[SDK provenance](../../vendor/apps-sdk/SOURCE.json), and
[repository SDK documentation](../../docs/sdk.md). Do not edit generated SDK
files, import Radius source, copy privileged preloads, or implement a general
`call` bridge. The SDK package name is for authoring/tests; the local app uses
the admitted document's `window.radiusApp` directly.

## Small, named operations

| Public operation | View behavior |
| --- | --- |
| `describe()` | Read manifest/installation/grants and `actions.generate.unavailable`. Only explicit `null` confirms action availability; discovery grants nothing. |
| `invoke('generate', {})` | Only an explicit Run now click. Read the returned receipt, not an assumed report. Never pass configuration/priorities through action input. |
| `getRun(runId)` | Inspect a known host-issued receipt. Display only public receipt fields, including `error.code` and effects. |
| `events(after?)` | Part of the base SDK; this example does not subscribe. Refresh status does explicit reads; only a selected unfinished run is polled. |
| `getInstance()` | Preview extension: current bound metadata/configuration or `null`; never state or another chosen instance. |
| `listRuns()` | Preview extension: bound run metadata, filtered in the UI to `generate`; full receipts are fetched with `getRun`. No owner/instance arguments. |
| `cancelRun(runId)` | Preview extension: explicit cancellation request for a known run, followed by `getRun`. Its return value is not treated as proof of cancellation. |
| `listArtifacts()` | Preview extension: scoped metadata list only after the optional `readReports` grant is present. No HTML is embedded or fetched. |
| `openArtifact(artifactId)` | Preview extension: explicit click and separate `openReports` grant, checked again before dispatch. No regeneration. |
| `listTriggers()` | Preview extension: actual bound schedule metadata, read-only. A trigger declaration is not an enabled binding. |

The six named extensions were checked against the maintainer-provided public
SDK preview declarations. The three list methods return arrays; `getInstance`
returns instance metadata including `id`, `configuration`, and
`configurationRevision`, or `null`. `listRuns` omits result bodies, so selected
receipts are fetched through `getRun`. `cancelRun` returns run metadata, not a
claim of confirmed cancellation. The reviewed vendored SDK export is a separate
maintainer-owned dependency change; the four-method snapshot remains supported.
These tests do not stand in for that export or verify a host bridge.

Optional `describe().generation` contains `profile`, `available`, `unavailable`,
and `usageBudget: { maxTotalTokens, maxCostUsd }`. The view shows its host reason
independently from app grants and labels its budget as required ceilings, not
actual usage or proof of enforcement. Optional receipt `usageBudget` is shown
as admitted ceilings, never filled from the current description. Missing fields
stay unknown. No host constant, token count, or USD limit is hard-coded into the
view; a future host's different values are displayed as reported.

Each extension is tested with `typeof sdk[name] === 'function'`. A missing
method yields specific native-management guidance, not a made-up response or
new worker action. Missing instance read support keeps Run now disabled. A
missing optional report grant prevents even the corresponding metadata read.
The host must recheck actual authority at dispatch; UI checks are not a security
boundary. The `allowAgentInvocation` installation flag is not a view permission
and is not used to override `actions.generate.unavailable`.

## Native management, not app escalation

The native host pins this document to its exact URL. Local guidance and skip
links prevent default navigation and scroll/focus their target without changing
the fragment. A hash router or ordinary anchor navigation can invalidate the
document-bound bridge; use in-memory UI state for this preview's routing.

The user-only host configuration update uses revision-checked configuration
replacement, preserves admitted run snapshots/history, and disables existing
trigger bindings pending explicit reapproval. No configuration write, grant
approval, instance creation, or schedule mutation is exposed or attempted here.
The app simply displays the current `configurationRevision` and saved values.

The HTML's `#native-management` target explains how to use native Apps
management. It is not a host deep link: no public navigation method is currently
documented. Do not substitute `window.open`, privileged RPC, URLs constructed
from raw IDs, or CLI/admin methods from inside the app.

## Generation context is host-owned

The existing action still has an empty, closed input schema and the sole
`previous-local-day` activity selector. The host supplies this bounded context:

```text
{
  schemaVersion: 1,
  logicalTime,
  configuration: { title, timeZone, todayPriorities? },
  input: {},
  activity: [{ requirement, since, until, fields, records }]
}
```

The host computes the local calendar-day interval and projects only approved
`title`, `createdAt`, and `updatedAt` fields. No app code computes yesterday from
the machine clock, reads raw conversations, or supplies extra context. Optional
priorities are saved configuration, not a new source capability. The schema
counts Unicode code points, so an HTML `maxlength` measured in UTF-16 units would
not replace host validation. No configuration form exists here. Saved priorities
are reused until the user changes or clears them, not live calendar-day data.

The [prompt](bundle/prompts/brief.md) treats every envelope value as untrusted,
uses an explicitly attributed priorities section, and does not treat titles as
evidence of decisions, completed work, or unanswered conversation questions.
It requires script-free, network-free HTML and separate publication/opening.
Text assertions test these instructions, not model compliance or sanitization.
Real generation remains blocked until the host has an enforceable hard-budget
runner; do not introduce another provider or ordinary-chat fallback to demo it.

## Lifecycle and partial outcomes

The controller serializes user operations. It re-reads availability, instance,
and history immediately before an explicit invocation. Known unfinished runs
block a duplicate run. A malformed or lost admission receipt leaves an unknown
outcome and blocks replay; inspect native history instead of retrying blindly.

Run checking has a one-second polling interval and a 125-second local wait
limit, independent of the shared 80 ms CSS interaction duration. A hidden
document skips checks; `pagehide` clears timers and ignores late results.
Permission/revocation errors stop checks and require reopening the view; ordinary
errors stop checks without replay. The controller never claims that stopping
observation cancels a run. A pending host promise itself cannot be aborted by
this narrow API; teardown prevents subsequent rendering or polling.

`queued`, `running`, and `cancelling` are unfinished. Only `succeeded` exposes
the action result. `failed`, `cancelled`, and `interrupted` show their public
error/effects without claiming rollback. All statuses/timestamps come from the
host. Configuration panels show current saved configuration, not a claim that
a past run used it: the view receipt has no configuration snapshot field.

Rendering uses `textContent` and local elements; report bodies, error messages
not in the public receipt type, transcript payloads, URLs, and private host
fields are not consumed. There is no persistent local cache, network client,
HTML injection, fake report, automatic action, or screenshot generator.

## Verification

```sh
node --test apps/morning-brief/test/*.test.mjs
pnpm check
```

Review [README.md](README.md) for offline/native evidence and remaining gates.
The preview SDK export, named methods, configuration policy and development
loop are documented in [the public contract](../../docs/app-contract.md),
[SDK provenance](../../docs/sdk.md), and [developer workflow](../../docs/development.md).
Local functional checks are not signed-release, accessibility or real-generation
acceptance. Keep those claims separate when developing another app.
