# Morning Brief

**Native generation is currently blocked.** The experimental production host
does not expose a restricted agent profile with verified hard usage limits and
advertises generation as unavailable. `generate` must fail with
`CAPABILITY_UNAVAILABLE`; this app provides no fake report, ordinary-chat
fallback, alternate provider, or broader runner.

This bundle retains the `dev.radius.morning-brief` app ID. Version `1.1.0` adds
a local vanilla HTML/CSS/JavaScript dashboard and a
[public-SDK developer example](DEVELOPER.md). It contains the original agent
action/prompt, not a JavaScript worker or provider SDK. There are no runtime npm
dependencies, network requests, or Radius-internal APIs. Validation/build can
run locally without executing the agent.

## The app screen

- Capability and grant availability, with Run now disabled until the host
  explicitly confirms availability, required grants, and a readable bound
  instance. Grants do not enable the current unqualified generation runner.
- The host's optional generation availability/reason is separate from grants.
  Host and receipt budgets are labeled required/admitted ceilings, not actual
  usage. Values come only from the host; omitted metadata stays unknown.
- Current saved instance title, timezone, configuration revision, and optional
  priorities, rendered as text. No clock/focus-derived configuration, form,
  instance creation, or automatic action.
- Explicit `invoke('generate', {})`, public receipt status/ID/timestamps, error
  code, and effect statuses. No fake percentage, automatic retry, or fallback.
- One-second receipt checks, bounded to 125 seconds. Stop checking and a wait
  timeout are not cancellation. Closing stops polling, not the host run.
- Explicit scoped Cancel run when supported. `cancelling` is not `cancelled`;
  already committed effects cannot be undone.
- Saved artifact metadata only with optional `readReports`. Open report is a
  separate click with a fresh `openReports` check, never regeneration. No report
  body is embedded, and no report is opened on load or generation completion.
- Actual schedule bindings read-only when supported. The manifest's `08:30`
  suggestion is never presented as an enabled binding.

Feature checks support older four-method hosts with explicit native-management
guidance. Unsupported data is labeled unavailable, not invented or presented as
an empty history. Run now stays disabled when bound configuration cannot be
confirmed. The native-management links lead to in-page guidance, not invented
native URLs: there is no public management-navigation or administrative method.
See [method contracts and compatibility](DEVELOPER.md).

## Local development

```sh
pnpm install --ignore-scripts --frozen-lockfile
pnpm app validate morning-brief
node --test apps/morning-brief/test/*.test.mjs
pnpm app build morning-brief
pnpm check
```

None of these commands installs an app, enables a schedule, grants capabilities,
invokes a model, or launches Radius. Bundle bytes changed at `1.1.0`; use a new
reviewed digest, never a previous immutable version/digest mapping.

## Requested access

- `activity`: `activity.read` for one previous local day of conversation
  metadata, with exactly `title`, `createdAt`, and `updatedAt` fields.
- `generation`: `agent.run` with the `restricted-generation` profile.
- `reports`: `artifacts.write` with `{ "owner": "self" }`.
- `readReports`: optional `artifacts.read` with `{ "owner": "self" }` for saved
  artifact metadata, not activity or transcripts.
- `openReports`: optional `artifacts.open` with `{ "owner": "self" }`.

Generation requires only `activity`, `generation`, and `reports`, not either
optional report grant. Declaring `readReports` does not approve it or broaden an
existing grant. Conversation metadata
does not mean transcripts, browsing history, page contents, or URLs. The prompt
treats supplied data as untrusted and asks for compact, script-free, network-free
HTML. The host validates and publishes an immutable artifact; the action's result
is `{ "artifactId": "…" }`, not an already-open report.

## Instances, schedules, and delivery

An instance must be explicitly created with a title and an IANA timezone, for
example `{ "title": "Morning Brief", "timeZone": "America/Los_Angeles" }`.
The existing required fields and instance state schema version 1 are unchanged.
Optional `todayPriorities` accepts empty text or up to 2,000 Unicode code points:

```json
{
  "title": "Morning Brief",
  "timeZone": "America/Los_Angeles",
  "todayPriorities": "Review the proposal; make time for focused writing."
}
```

Old configurations without priorities remain valid. Saved priorities are reused
until the user edits or clears them, not live calendar-day data or an automatic
daily reset. Edit these settings in native Apps management. Host updates use a
configuration-revision check, preserve history/admitted run snapshots, and
disable existing schedule bindings until the user explicitly reapproves them.
The app view has no configuration-write, grant, or schedule-write method.

The timezone is a user choice, not inferred from the viewer or a test machine.
The `previous-local-day` selector uses logical run time and that timezone; it is
not a rolling 24-hour interval.

The `morning` trigger suggests `08:30`; a declaration is not an enabled binding.
Installation creates neither an instance nor an enabled schedule. Any future
invocation or schedule needs a separate user decision, available enforceable
limits, an approved instance/timezone/local time, and a delivery policy. Radius
must be running for schedules. Opening a saved artifact does not regenerate it.
Publishing and opening are separate authorizations.

The coordinated host generation envelope is
`{ schemaVersion: 1, logicalTime, configuration, input, activity: [{ requirement, since, until, fields, records }] }`.
This host-context change is an integration dependency, not something supplied
by the app view or proven by DOM tests. The prompt treats every value as
untrusted, uses inclusive `since` / exclusive `until` host bounds, attributes
priorities to the user, and treats titles as topic cues, not evidence of
conversation decisions, completed work, or unanswered questions.

## Evidence and pending work

Tests validate the public manifest, packaged prompt, exact requirements,
backward-compatible configuration, Unicode bounds, trigger defaults, and result
schema. The real view controller also runs against tiny trusted DOM/SDK doubles
with explicitly synthetic receipts and artifact metadata. Those are developer
fixtures, not a security sandbox, native certification, or generated reports.
Those unit tests make no provider calls, native/UI launches, installs, grants,
or captures.

The UI uses one shared 80 ms interaction token and disables motion under Reduced
Motion. Responsive light/dark CSS, keyboard focus, and live regions exist, but
this change makes no complete responsive/accessibility acceptance claim.
A paired local host functionally exercised the real dashboard, scoped metadata,
cross-app artifact denial, configuration revisions, and revocation without model
calls. Its complete native harness stayed non-passing because concurrent lab work
changed the display inventory. The final in-page link fix has a unit regression;
its native assertion still needs a quiet rerun. Real generation/budget enforcement
and signed release acceptance remain unverified.

`screenshots` is intentionally empty: a local dashboard capture is not a generated
report or final native certification. The app is licensed under [MIT](bundle/LICENSE). Source
publication does not enable generation, schedules or delivery, and no
signed/catalog release exists.
