# Scheduled-agent starter

**Native generation is blocked on the current experimental host.** This is a
runnable local validation/test fixture, not a working native generation demo.
It requires an enforceably bounded `restricted-generation` profile; if absent,
the host must return `CAPABILITY_UNAVAILABLE`. Never substitute a provider call,
ordinary chat, unrestricted runner, or fabricated report.

```sh
pnpm app create my-report --template scheduled-agent
pnpm app validate my-report
node --test apps/my-report/test/*.test.mjs
pnpm app build my-report
pnpm app install my-report
```

From the catalog root, these validate/test/build or print manual installation
instructions. They do not start agents, contact providers, approve grants, enable
schedules, or launch Radius. Review the generated identity and metadata.

The bundle has no JavaScript worker or view. Its `generate` action declares a
local prompt, `restricted-generation`, approved `previous-local-day` activity,
and an `html-artifact` result. The worker API cannot replace this descriptor with
an ad hoc agent loop. `activity` requests only conversation metadata fields
`title`, `createdAt`, and `updatedAt`; it does not request transcripts or pages.
`reports` allows owned artifact publication, not opening. No delivery permission
is requested by this starter.

For future native use, separately approve the requested requirements and create
an instance with a title and explicit IANA timezone. Then separately review any
schedule binding, including its input, timezone, local time, budget and delivery.
The `daily` trigger only suggests `09:00`; its manifest has no enabled state.
Installing the app does not create a schedule or instance. Radius must be running
for schedules. Reopening an existing artifact must not regenerate it.

Run original template tests with
`node --test templates/scheduled-agent/test/*.test.mjs`. These validate the bundle,
prompt and schemas only; no model is invoked and no report is generated. Native
budget, scheduler, artifact and delivery tests belong to the host. No verified
screenshots exist, so `screenshots` stays empty. `UNLICENSED` is a placeholder,
not a license grant or publication approval.
