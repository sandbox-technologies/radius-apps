# Scheduled Report Lab

An **experimental, deterministic synthetic-report app**, version `0.1.0`, with
ID `dev.radius.scheduled-report-lab`. It is not AI, does not generate a Morning
Brief, and is not a fallback for the blocked Morning Brief agent. Every report
is labeled synthetic test data. No model, provider, live activity, browser tab,
network request, storage permission, or credentials are needed.

**Run native checks only in an explicitly selected disposable test profile.**
Use synthetic input, never personal or production data. Installing this bundle
does not create an instance, approve permissions, invoke an action, open a tab,
or enable a schedule. These instructions do not authorize those actions.

## Local checks

From the repository root:

```sh
pnpm app validate scheduled-report-lab
node --test apps/scheduled-report-lab/test/*.test.mjs
pnpm validate
```

The self-contained installable directory is
`apps/scheduled-report-lab/bundle/`: `radius-app.json`, `worker.js`, and `LICENSE`.
Optional `pnpm app build scheduled-report-lab` copies only those files to
`dist/apps/scheduled-report-lab/`. No runtime build step or external assets are
required. `pnpm app install scheduled-report-lab` only builds and prints manual
review/install instructions; it does not launch or communicate with Radius.

## Worker interface and permission boundary

`worker.js` exports `async generate(input, context)`. Instances use `multiple`
mode; each must be explicitly created with configuration:

```json
{ "title": "Disposable synthetic report", "timeZone": "America/Los_Angeles" }
```

Both fields are required and extra fields are rejected. `title` is 1–80 Unicode
code points; blank/control-character titles fail before publication. The bound
keeps even an all-astral title plus its fixed synthetic suffix within the host's
200 UTF-16-unit artifact-title limit. `timeZone` is 1–100 code points. Supply an
IANA timezone: the host validates it when configuring a schedule. The worker
only escapes and displays this label; it does not validate IANA identifiers,
infer the viewer's timezone, or pretend to convert UTC to local time. Keep the
binding timezone the same as the instance configuration.

Action input is a closed object with two optional fields:

```json
{
  "note": "Deliberately supplied synthetic fixture",
  "items": [
    { "label": "Synthetic sample A", "value": 3 },
    { "label": "Synthetic sample B", "value": 5 }
  ]
}
```

`note` is at most 500 code points. `items` contains at most 20 closed objects;
each requires a 1–120-code-point `label` and an integer `value` from 0 through
1,000,000. `{}` uses a bundled note and three fixed values, 3, 5, and 8. An
explicit empty array remains empty. There is no fetched or inferred input.

The worker reads `context.metadata.configuration` and the required canonical
UTC `context.metadata.logicalTime`, escapes every inserted string, and makes
exactly one call:

```js
const { artifactId } = await context.host.call('artifacts.publish', { html, title })
return { artifactId }
```

The published title is the configured title plus ` — Synthetic report`. HTML
contains the logical UTC instant, configured timezone label, synthetic labels,
values and total. It has no scripts, styles, links, images, forms or remote
assets; an additional `default-src 'none'` meta policy is included. The worker
does not rely on publication sanitizing HTML. Native containment/presentation
is the host's responsibility and needs independent verification.

Identical configuration, input and logical time produce byte-identical HTML
and title, independent of run/installation/instance IDs. Host-generated artifact
IDs, creation timestamps and receipts are not deterministic and are not proof
of opening. Publication errors propagate without a retry or fabricated result;
inspect the receipt for partial/unknown effects before retrying.

The action requires only `reports`: `artifacts.write` with
`{ "owner": "self" }`. `openReports`: `artifacts.open` with that same scope is
declared separately and is **not** required by `generate`. Grant it only if
separately authorizing scheduled background delivery. There is no app action
that opens a report and no `agent.run` or `storage.instance` requirement.

## Manual native configuration and invocation

The following are manual patterns, not commands run by local tests. First have
the native-test owner start an isolated test host. Do not use `--launch`. Replace
`HOST`, `PROFILE`, `INSTALLATION`, `APP_INSTANCE`, `RUN`, `ARTIFACT`, `BUNDLE` and
`DIGEST` with reviewed values from that disposable host; `BUNDLE` must be an
absolute bundle path and `DIGEST` must be the matching review digest. Keep
`--instance` (host selection) distinct from `--app-instance` (app configuration).
Pass explicit host and profile selectors on every call; do not rely on focus.
Start commands with `radius apps`; put selectors after the apps subcommand and
its arguments, not before `apps` (the CLI does not parse leading global flags).

Review and, only with separate approval, install without any grants:

```sh
radius apps call apps.review --input '{"path":"BUNDLE"}' --instance HOST --profile PROFILE --json
radius apps install BUNDLE --expected-digest DIGEST --grant '' --allow-agent-invocation false --instance HOST --profile PROFILE --json
radius apps describe INSTALLATION --instance HOST --profile PROFILE --json
```

Only after reviewing and approving publication, grant `reports`, create a
configured instance, and explicitly invoke the fixture renderer:

```sh
radius apps grants INSTALLATION --grant reports --allow-agent-invocation false --instance HOST --profile PROFILE --json
radius apps call instances.create --input '{"installationId":"INSTALLATION","configuration":{"title":"Disposable synthetic report","timeZone":"America/Los_Angeles"}}' --instance HOST --profile PROFILE --json
radius apps invoke INSTALLATION generate --app-instance APP_INSTANCE --input '{}' --idempotency-key synthetic-report-manual-1 --instance HOST --profile PROFILE --json
radius apps run RUN --instance HOST --profile PROFILE --json
radius apps call artifacts.list --input '{"installationId":"INSTALLATION"}' --instance HOST --profile PROFILE --json
```

Admission is not completion. Inspect the run until terminal and require
`status: "succeeded"`, a result `{ "artifactId": "…" }`, and a committed
`artifacts.publish` effect. It must not contain a worker `artifacts.open` or
provider effect. A later independent invocation needs a new idempotency key;
reuse a key only for the same logical invocation and unchanged arguments.

An explicitly approved user can open the saved artifact without invoking
`generate` again:

```sh
radius apps call artifacts.open --input '{"artifactId":"ARTIFACT"}' --instance HOST --profile PROFILE --json
```

This is a separate user host operation, not an implicit worker permission or
scheduled-delivery grant. Verify no new run/artifact appears solely from opening.

## Daily schedule and separately approved delivery

The `daily` trigger suggests `08:30` local time with `{}` input. It declares no
enabled state. Radius must remain running for the scheduler to process it.
First configure a disabled, non-delivering binding and inspect it:

```sh
radius apps call triggers.configure --input '{"installationId":"INSTALLATION","instanceId":"APP_INSTANCE","trigger":"daily","enabled":false,"localTime":"08:30","timeZone":"America/Los_Angeles","delivery":"none","input":{}}' --instance HOST --profile PROFILE --json
radius apps call triggers.list --input '{"installationId":"INSTALLATION"}' --instance HOST --profile PROFILE --json
```

Only after separate approval of instance, timezone, local time and synthetic
input, enable publication with no automatic opening:

```sh
radius apps call triggers.configure --input '{"installationId":"INSTALLATION","instanceId":"APP_INSTANCE","trigger":"daily","enabled":true,"localTime":"08:30","timeZone":"America/Los_Angeles","delivery":"none","input":{}}' --instance HOST --profile PROFILE --json
```

Use the host's scheduled logical instant in evidence, not the worker's wall
clock; late processing can differ from that instant. The worker displays UTC
without implementing its own day-boundary or daylight-saving calculation. Check
host occurrence, run and artifact records to verify scheduling; a mock test or
a manual invocation is not scheduler evidence.

Background delivery requires an additional explicit decision. `apps grants`
replaces the complete set, so retain `reports` when adding `openReports`:

```sh
radius apps grants INSTALLATION --grant reports,openReports --allow-agent-invocation false --instance HOST --profile PROFILE --json
radius apps call triggers.configure --input '{"installationId":"INSTALLATION","instanceId":"APP_INSTANCE","trigger":"daily","enabled":true,"localTime":"08:30","timeZone":"America/Los_Angeles","delivery":"background-tab","input":{}}' --instance HOST --profile PROFILE --json
```

The scheduler, not the worker, performs delivery and records `artifacts.deliver`.
Granting `openReports` alone does not enable delivery. After testing, explicitly
disable the binding with `enabled: false` and `delivery: "none"`, revoke the
test grants with `apps grants INSTALLATION --grant ''`, and have the test owner
dispose of the test profile. Keep the same explicit host/profile selectors.

## Evidence limits

Tests validate the public SDK schemas/bundle/license and exercise the actual
worker against a local host double: one publish call, escaped hostile strings,
deterministic content, bounded inputs, and failure propagation without implicit
opening or provider calls. These tests are not a native worker sandbox, native
scheduler, grant-enforcement, artifact-delivery or presentation test. They do
not establish successful agent generation, which this app never attempts.

Native acceptance belongs to the separate isolated-host test owner, who must
record the exact app digest, host build, disposable profile, approvals, receipts
and remaining gaps. Screenshots are intentionally empty; no native capture is
claimed. The bundle includes the approved [MIT license](bundle/LICENSE).
