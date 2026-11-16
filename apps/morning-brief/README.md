# Morning Brief

**Native generation is currently blocked.** The experimental production host
does not expose a restricted agent profile with verified hard usage limits and
advertises generation as unavailable. `generate` must fail with
`CAPABILITY_UNAVAILABLE`; this app provides no fake report, ordinary-chat
fallback, alternate provider, or broader runner.

This is a schema-valid agent-only bundle, retaining `dev.radius.morning-brief`
version `1.0.0`. It contains a prompt, not a JavaScript worker or a provider SDK.
Validation/build can run locally. They do not execute the agent.

## Local development

```sh
pnpm app validate morning-brief
node --test apps/morning-brief/test/*.test.mjs
pnpm app build morning-brief
pnpm app install morning-brief
```

The last command only prints installation instructions. None of these commands
enables a schedule, grants capabilities, invokes a model, or launches Radius.

## Requested access

- `activity`: `activity.read` for one previous local day of conversation
  metadata, with exactly `title`, `createdAt`, and `updatedAt` fields.
- `generation`: `agent.run` with the `restricted-generation` profile.
- `reports`: `artifacts.write` with `{ "owner": "self" }`.
- `openReports`: optional `artifacts.open` with `{ "owner": "self" }`.

Generation requires the first three, not `openReports`. Conversation metadata
does not mean transcripts, browsing history, page contents, or URLs. The prompt
treats supplied data as untrusted and asks for compact, script-free, network-free
HTML. The host validates and publishes an immutable artifact; the action's result
is `{ "artifactId": "…" }`, not an already-open report.

## Instances, schedules, and delivery

An instance must be explicitly created with a title and an IANA timezone, for
example `{ "title": "Morning Brief", "timeZone": "America/Los_Angeles" }`.
The timezone is a user choice, not inferred from the viewer or a test machine.
The `previous-local-day` selector uses logical run time and that timezone; it is
not a rolling 24-hour interval.

The `morning` trigger suggests `08:30`; a declaration is not an enabled binding.
Installation creates neither an instance nor an enabled schedule. Any future
invocation or schedule needs a separate user decision, available enforceable
limits, an approved instance/timezone/local time, and a delivery policy. Radius
must be running for schedules. Opening a saved artifact does not regenerate it.
Publishing and opening are separate authorizations.

## Evidence and pending work

The tests validate the public manifest, packaged prompt, exact requirements,
trigger defaults, and result schema. They make no provider calls and do not
simulate successful native generation. Native budget enforcement, scheduling,
artifact sanitization/presentation, and delivery remain host integration work.

`screenshots` is intentionally empty: no native generation or report capture
has been verified. `UNLICENSED` is a placeholder, not permission to publish or
reuse under an invented license.
