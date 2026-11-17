# Radius Apps developer preview

This workflow requires a compatible experimental Radius build with the Apps
developer CLI and scoped lifecycle bridge. It is not a published stable host or
a store release. Scaffold/build/unit tests still work without running Radius.

## Local edit and inspect loop

From this repository:

```sh
pnpm app validate morning-brief
node --test apps/morning-brief/test/*.test.mjs
radius apps dev ./apps/morning-brief --profile DEVELOPMENT_PROFILE_ID
```

Choose an **already-running development host and dedicated persistent profile**.
Use `--instance HOST_INSTANCE_ID` as well if multiple Radius processes are
running. The CLI does not create profiles, launch Radius, or fall back to the
everyday profile. It accepts an app directory containing `bundle/`, a bundle
directory, or its `radius-app.json`.

For each changed digest, the CLI asks for explicit review before installation or
update. First installation grants nothing and creates no instance or schedule.
An update preserves only unchanged existing grants, disables trigger bindings,
and revokes old views. Watching unchanged bytes does not disable an already
enabled schedule; start from a dedicated development profile.

The watcher reads the host's validated bundle snapshots. It does not run build
scripts or transpile a framework project. For these no-build examples, edit the
local HTML, CSS, JS, or prompt, then approve the changed snapshot. Other projects
must compile to local bundle assets themselves. The CLI never invokes an action
or model because a file changed.

## Configure and open Morning Brief

Use the user-authorized management surface to review permissions and create an
instance with a title, IANA timezone, and optional stated priorities:

```sh
radius apps manage --profile DEVELOPMENT_PROFILE_ID
```

For a CLI workflow, replace `INSTALLATION_ID` with the returned installation:

```sh
radius apps call instances.create --profile DEVELOPMENT_PROFILE_ID --input '{"installationId":"INSTALLATION_ID","configuration":{"title":"Morning Brief","timeZone":"America/Los_Angeles","todayPriorities":"Review the launch checklist."}}' --json
radius apps dev ./apps/morning-brief --profile DEVELOPMENT_PROFILE_ID --app-instance APP_INSTANCE_ID
```

Replace `APP_INSTANCE_ID` with the created instance. Creating it grants nothing.
Review permissions in management; never approve every requirement as a shortcut.
The optional report-list and report-open grants are separate from generation.
Configuration edits use revision checks, retain history, and disable changed
instances' triggers until reapproved.

The app shows capability status, configuration, recent runs, receipts, saved
reports, and schedule bindings when the host exposes the lifecycle methods.
Unsupported methods produce an explanation, not a simulated successful result.
**Real generation is still unavailable:** the reviewed native harness lacks a
verified hard pre-spend budget. No alternate provider or ordinary-chat fallback
is installed by this workflow. The app's Run now button remains disabled.

## Diagnostics and safe retries

The watcher prints discovery/action availability and changed run metadata. It
does not read private run inputs/results automatically. Inspect a receipt with:

```sh
radius apps run RUN_ID --profile DEVELOPMENT_PROFILE_ID --json
```

`--no-open` inspects without opening a view. For noninteractive automation, use
`--once --expected-digest REVIEWED_SHA256 --jsonl` after reviewing exactly that
digest in the same profile. There is no blanket approval flag. JSONL output is
an event stream, not one JSON result.

A failed or declined digest is not automatically retried, including an update
blocked by active runs. Inspect the outcome and restart the watcher to retry.
Ctrl+C stops the watcher, not app runs, installations, or previously enabled
schedules. Cancel a run or disable a binding explicitly in management.

## Preview limits

Individual immutable snapshots are bounded, but accumulated review snapshots do
not yet have an aggregate host-owned quota or retention policy. Repeated edited
reviews can grow disk usage; `--no-open` does not prevent this. Closing a tab does
not reclaim the native experimental host's 64 partition reservations per browser-
context lifetime. Stop on a resource-limit error and restart the dedicated development
host as appropriate; never bypass limits or delete a live host store. Schedules currently require
Radius to be running. Developer validation, mock tests, and this workflow do not
establish production signing, publisher trust, real agent execution, or catalog
readiness.
