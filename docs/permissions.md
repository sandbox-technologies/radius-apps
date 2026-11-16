# Permissions and explicit targets

A requirement is a request, not a grant. A catalog entry, valid schema, signed
release, app view, agent token, or successful test cannot approve access. The
Radius host determines the principal and rechecks authority around effects.
Apps must not read current focus to infer the user's intended target.

## Ask for the smallest exact scope

These are the public capability scopes. Unknown fields are not silently ignored.
Grant names (such as `queueState`) are defined by the manifest; capability names
(such as `storage.instance`) identify what they request.

| Capability | Exact scope shape |
| --- | --- |
| `storage.instance` | `{ "instance": "self" }` |
| `tabs.read` | `{ "target": "invocation", "fields": ["title", "url"] }`; choose a nonempty unique subset of those fields |
| `tabs.layout`, `chat.draft` | `{ "target": "invocation" }` |
| `activity.read` | `{ "source": "conversation-metadata", "fields": ["title", "createdAt", "updatedAt"], "days": 1 }`; fields are a nonempty unique subset and days is an integer from 1 to 31 |
| `agent.run` | `{ "profile": "restricted-generation" }` |
| `artifacts.read`, `artifacts.write`, `artifacts.open` | `{ "owner": "self" }` |
| `events.subscribe` | `{ "target": "self", "events": ["instance.state.changed"] }`; a nonempty unique subset of `APP_HOST_EVENTS` |

`APP_HOST_EVENTS` currently contains `instance.state.changed`, `run.completed`,
and `artifact.created`. An app's declared event `changed` is emitted as
`app.changed`; it is not an arbitrary host-event subscription. The view's
document-bound `events()` API is distinct from declaring an event trigger.
Every action lists only the named requirements it actually needs.

Reading Queue's direct add/list need only `queueState`; saving captured page
metadata additionally needs `selectedPage`. Focus Layout's split needs only
`layout`; the blocked draft action additionally requests `draft`. Morning Brief
publishes with `reports`; `openReports` is separate optional consent for opening,
not a prerequisite for generation. Its activity scope is conversation metadata,
not transcripts, browsing history, page bodies, or URLs.

## Installation is a separate user decision

`pnpm app install <slug>` only builds locally and prints manual review/install
commands. The printed installation pins the expected digest and explicitly
requests no grants and no agent invocation permission. Do not run it as part of
validation or tests. User approval of a requirement belongs to a separate
reviewed administrative action, not the app's worker/view or an agent transport.

Select the intended profile, review the exact digest, and approve only needed
requirements. If the bundle changes after review, review it again; a familiar
slug or version is not proof of matching bytes. Installation must not enable
schedules, create instances, run an agent, or open an artifact.

## Captured tab contexts

A tab action receives a host-issued context handle in the invocation, not a tab
ID embedded in action input. Capture and use the handle in the same authenticated
caller session, with an explicitly selected tab and window. For a user who has
already installed and granted Reading Queue's required access, the CLI shape is:

```sh
radius apps call contexts.create --input '{"tabId":"tab_12","windowId":"window_1"}' --json
radius apps invoke install_queue addSelectedPage --app-instance instance_queue --context context_example --idempotency-key captured-page-1 --json
```

Replace every illustrative ID with the actual host result/selected target. These
are manual usage instructions, not commands run by authoring tooling. Inspect the
returned run's receipt. Capture handles expire and are invalidated by relevant
navigation, revocation, or caller changes. Reusing a stale handle must fail; do
not silently switch to the focused tab or another window.

A worker calls `tabs.read` with `{}` or `tabs.split` with its declared direction.
The host resolves the invocation target. It never accepts an app's assertion
that another tab is authorized. A view's `invoke` can receive a handle only if
the host issued that handle to the exact view caller. Pasting a CLI handle does
not transfer authority, and the narrow view SDK has no capture method. If there
is no view target picker, use direct-entry functionality instead.

## Native features that remain blocked

Focus Layout's `splitAndDraft` needs a separate authorized draft destination
and a verified native create-if-empty primitive. The current adapter does not
provide it, so that action is unavailable before admission. Do not use the new
split pane, current focus, a send API, or a raw tab ID as a workaround.

Morning Brief and the scheduled-agent starter need a restricted profile with
enforceable hard usage limits. Current native generation is unavailable and
must fail closed with `CAPABILITY_UNAVAILABLE`. App authors cannot add an
ordinary-chat/provider fallback or disable the limit. Local mock tests do not
change capability availability.

## Schedules, artifacts, and partial effects

A schedule declaration suggests an action/input/local time; it contains no
enabled state. A later binding requires a separate user decision about instance,
timezone, local time, usage limits, and delivery. Specify an IANA timezone;
`previous-local-day` is a calendar interval in that zone, based on logical run
time, not a rolling 24 hours. Radius must be running for schedules. A default
suggestion must not be treated as approval.

Artifact publication and opening are different effects and capabilities. A
returned `artifactId` does not mean a report was opened. Reopening a saved report
must not regenerate it. Do not auto-enable delivery or broaden its scope.

Effects can partially commit. A queue write can succeed before event emission
fails; a future admitted split/draft action could split before draft failure.
Propagate errors and inspect the receipt's `committed`, `failed`, or `unknown`
effects. Do not claim rollback, repeat effects blindly, or treat a UI timeout as
run cancellation. Use an explicit idempotency key for a logical mutating CLI
invocation; it is not a substitute for reviewing ambiguous effects.
