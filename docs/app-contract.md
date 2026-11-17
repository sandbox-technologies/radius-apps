# Public app contract

Apps target `schemaVersion: 2` and `apiVersion: "radius.apps/1"` in
`bundle/radius-app.json`. The generated `@radius/apps-sdk` is the public
authoring authority for parsing/validation. Radius owns runtime identity,
permission enforcement, captured targets, state, run receipts, and effects.
Do not import Radius internals or implement another privileged transport.

## Two JSON files, different purposes

`apps/<slug>/app.json` is catalog metadata, outside the installed bundle. The
initial apps and templates use exactly this shape:

```json
{
  "schemaVersion": 1,
  "slug": "my-app",
  "title": "My App",
  "summary": "A short, honest description.",
  "status": "experimental",
  "license": "MIT",
  "authors": [{ "name": "Your name" }],
  "categories": ["productivity"],
  "screenshots": []
}
```

The slug matches the directory. Status is `experimental` or `ready`; current
examples remain experimental. MIT is the approved license for the repository,
reference apps and templates. Each bundle includes its own `LICENSE`; retain
that notice when copying a template. Screenshots name local image assets when
verified captures exist; an empty list is intentional until then. Metadata and
source licensing grant no runtime permission or signed release provenance.

The runtime manifest instead describes a stable reverse-domain app ID, name,
semantic version, instance model, configuration schema, named requirements, and
the `provides` maps for actions, views, events, and triggers. A handler action
needs `worker.entry` and a named export. An agent action declares a packaged
prompt and restricted execution profile rather than a JavaScript provider call.
See the complete [interactive manifest](../templates/interactive/bundle/radius-app.json)
and [scheduled-agent manifest](../templates/scheduled-agent/bundle/radius-app.json).

## Authoring SDK

Import the public package in trusted Node authoring tools and tests:

```js
import { readFile } from 'node:fs/promises'
import {
  APP_API_VERSION, APP_SCHEMA_VERSION, AppContractError,
  parseAppJson, canonicalAppJson, parseAppManifest,
  validateAppSchema, validateAppValue, validateAppBundlePath,
} from '@radius/apps-sdk'

const manifest = parseAppManifest(parseAppJson(await readFile('bundle/radius-app.json', 'utf8')))
validateAppValue(manifest.provides.actions.greet.inputSchema, { name: 'Ada' })
```

Other public constants include `APP_CAPABILITIES`, `APP_HOST_EVENTS`,
`APP_LIMITS`, `APP_JSON_LIMITS`, and `APP_MANIFEST_LIMITS`. Treat limits as
contract ceilings, not author-controlled permissions. `AppContractError` carries
a `code`; preserve meaningful failures rather than turning them into success.

The Node-only `@radius/apps-sdk/release` subpath exposes
`validateAppBundleFiles`, `appBundleDigest`, `verifyAppCatalogRelease`,
`decodeAppBase64`, and `decodeAppText` for offline release inspection. A bundle
file map maps relative paths to canonical base64 bytes. Its digest covers all
file bytes, including the original `radius-app.json`, not filesystem timestamps
or external catalog metadata. Signature verification proves neither permission
consent nor current revocation status. Use the release workflow for publishing;
do not invent an independent digest or signature format.

## Strict JSON and schemas

Use `parseAppJson` rather than permissive JSON loaders: duplicate keys, unsafe
prototype keys, BOM, comments, nonfinite numbers, malformed Unicode, and
oversized/deep data are rejected. `canonicalAppJson` is Radius's own canonical
JSON dialect, not a claim of arbitrary JCS compatibility.

Schemas use one explicit type: object, array, string, number, integer, boolean,
or null. Objects are closed with `additionalProperties: false`; properties and
required names must agree. Supported constraints include `items`,
`minItems`/`maxItems`, `minLength`/`maxLength`, `minimum`/`maximum`, `enum`, and
`const`. String length counts Unicode code points. Descriptive `title`,
`description`, and schema-valid `default` are allowed. Defaults are not inserted.
There is no `$ref`, `format`, `pattern`, union, coercion, or ignored keyword.
Action input and configuration schemas are objects. Validate representative
inputs and outputs in tests; schema validity alone does not validate behavior.

## Worker SDK

A worker is local ESM. Each action identifies one exported handler:

```js
export async function readPage(_input, context) {
  const page = await context.host.call('tabs.read', {})
  return { title: page.title, url: page.url }
}
```

This action must declare the captured-tab context and its exact `tabs.read`
requirement. `context.host.call(method, input)` is the public effect broker,
not an arbitrary RPC channel. Supported calls used by these examples are:

| Method | Input | Result / meaning |
| --- | --- | --- |
| `storage.read` | `{}` | `{ revision, value }` for the bound instance |
| `storage.compareAndSet` | `{ expectedRevision, value }` | `{ revision }`; stale revisions fail |
| `tabs.read` | `{}` | Only the granted title/URL fields from the captured target |
| `tabs.split` | `{ direction: "right" }` | Host effect; do not select a new target yourself |
| `chat.createDraft` | `{ text }` | Intended unsent draft effect; currently unavailable natively |
| `events.emit` | `{ name, payload }` | Emits a declared app event; result is `null` |

The public `AppWorkerContext` type also describes read-only `metadata` (`runId`,
`installationId`, optional `instanceId`, configuration, and logical time),
`run` as an alias, `configuration`, and the read-only cancellation facade
`signal`. These are host-provided data, not caller-chosen principals. Cancellation
is enforced by the host; workers cannot undo already dispatched effects.

No Node builtins, DOM, privileged preload, network fetches, or bare npm imports
belong in installed workers. Package any supported helpers as local modules;
these starters need none. Never use worker globals as persistent state. Reading
Queue demonstrates revisioned host storage, conflict failure, and event emission
after commit. App tests may import workers in Node, but that is not the native
worker sandbox and gives no sandbox assurance.

## View SDK

The host injects `window.radiusApp` into an admitted app document. Its four
methods are:

- `describe()` returns manifest/discovery information, including action
  availability. Discovery does not grant access.
- `invoke(action, input, { contextHandle }?)` admits an action for the bound
  installation/instance and returns a run receipt with an `id`.
- `getRun(runId)` returns the current receipt. Only `succeeded` means the result
  is available. `queued`, `running`, and `cancelling` are not success; `failed`,
  `cancelled`, and `interrupted` are terminal failures.
- `events(after?)` returns `{ sequence, gap, events }`. Advance the cursor from
  `sequence`; refresh authoritative state after a gap or relevant newer event.

The developer-preview host also provides these optional lifecycle methods. Check
each method before using it; an older four-method bridge remains valid:

- `getInstance()` returns the bound instance's configuration and revisions, not
  its storage value; an unbound/stateless view receives `null`.
- `listRuns()` returns owned run metadata, not result bodies or private inputs.
- `cancelRun(runId)` cancels only a run within the view's installation/instance.
- `listArtifacts()` returns owned report metadata with an approved
  `artifacts.read` requirement. It does not return HTML or filesystem paths.
- `openArtifact(artifactId)` requires the separate `artifacts.open` grant.
- `listTriggers()` reads owned bindings; it cannot configure or enable them.

These methods do not accept installation IDs, instance IDs, or principals.
Radius binds ownership to the live app document and invalidates it on revocation.
See [Morning Brief](../apps/morning-brief/README.md) and the
[developer-preview workflow](development.md).

Use bounded polling for unfinished runs; a UI timeout is not cancellation.
Surface the run ID and error code, inspect effects, and do not automatically
replay ambiguous work. The public view receipt intentionally exposes less than
the full internal run; do not assume private fields or an error message exist.
See the [interactive view](../templates/interactive/bundle/ui/app.js) for a
small example and [Reading Queue](../apps/reading-queue/bundle/ui/app.js) for
event refresh. Stop event polling on teardown or bridge revocation.

The SDK package offers `getRadiusApp()` and editor types such as `RadiusAppView`,
`AppHandler`, and `AppWorkerContext`. The accessor is not an authority check or a
fallback bridge. Runtime package imports are not automatically resolved: these
no-build examples use the injected `window.radiusApp` directly. Do not import
the Node-only release subpath into a view.

Views cannot install apps, approve grants, pick another installation/instance,
capture targets themselves, or substitute raw tab IDs. No bridge in an ordinary
browser means an honest error, not simulated native success. Use local HTML,
scripts, and styles; render untrusted data as text. Use the shared 80 ms timing
token for short interactions, honor Reduced Motion, and never treat animation
duration as an input delay or continuous-pointer threshold.

The current host pins the view to its exact entry URL. Do not use path or hash
navigation for in-app routing: even a fragment change can revoke the document.
Use in-memory UI state, and intercept local guidance/skip links to scroll and
focus without changing the URL. Morning Brief demonstrates this behavior.

## Bundles, instances, and agents

Every referenced worker, view, prompt, and icon must be present in `bundle/`.
Keep all executable assets local. Portable paths are bounded, relative,
ASCII-only paths; traversal, absolute paths, backslashes, reserved filenames,
case collisions, links, and executable install hooks are not supported by the
authoring workflow. Use `pnpm app validate` and the public path/bundle validators.

Instance mode is `none`, `single`, or `multiple`. Stateless (`none`) apps cannot
request instance storage. Other modes need explicitly created instances; an
installation or opened document is not implicit consent to create one.

Users can edit non-secret instance configuration through native management or
the public administrative `instances.configure` operation. It requires
`installationId`, `instanceId`, `expectedConfigurationRevision`, and the complete
`configuration` object. Conflicting revisions fail; changed configuration
disables that instance's trigger bindings until explicitly reapproved. Existing
state/artifacts survive, and already admitted runs retain their original input
and configuration snapshot. Views cannot perform this administrative operation.
Management binds trigger previews/approvals to `expectedConfigurationRevision`;
stale approvals fail instead of silently re-enabling a trigger after an edit.
Programmatic callers can include this guard in `triggers.preview` and
`triggers.configure`. The runtime also rejects configuration changes racing a
pending trigger decision, including callers that omit the optional guard.

Agent actions use the `restricted-generation` profile, a local prompt,
explicit approved context selectors, and an `html-artifact` result containing
`artifactId`. Native generation is currently unavailable because an enforceable
profile budget is not verified. Triggers are declarations, not enabled bindings.
Installation never starts an agent or approves a schedule. See
[permissions](permissions.md) and [testing](testing.md) for the remaining gates.

The developer-preview host gives the restricted harness one structured,
untrusted JSON context with `schemaVersion: 1`, `logicalTime`, `configuration`,
`input`, and `activity`. Each activity entry contains `requirement`, `since`,
`until`, `fields`, and projected `records`. It exposes only the approved metadata
fields; no implicit transcripts, page contents, URLs, local files, or current
browser focus are added. The previous-day range uses the admitted logical time
and configured timezone, including daylight-saving boundaries. Prompt plus
serialized context share the host's input-size ceiling; all bindings share a
500-record maximum.

`describe().generation` discloses host capability availability separately from
missing app grants, and reports the required `usageBudget`. Agent run receipts
snapshot this budget. The current ceilings are 8,192 total tokens and USD 1;
these are admission limits, **not actual usage or evidence of enforcement**.
Generation remains unavailable unless the host's selected harness can enforce
both before spending. Older hosts may omit the added description/receipt fields.
