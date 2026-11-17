# Testing apps without overstating evidence

Local validation and mock tests are runnable without Radius, a native display,
provider credentials, or signing secrets. They are not the native runtime and
must not be described as a security sandbox, native certification, or successful
agent generation. Keep current catalog entries experimental.

## Commands

From the repository root:

```sh
pnpm app validate
node --test apps/*/test/*.test.mjs templates/*/test/*.test.mjs
pnpm app build
pnpm check
```

For a focused change:

```sh
pnpm app validate reading-queue
node --test apps/reading-queue/test/*.test.mjs
pnpm app build reading-queue
```

The explicit template glob tests the original starters; created apps place their
tests under `apps/<slug>/test/` and participate in the app test glob. `pnpm check`
runs the root validation/test/build workflow; keep template checks in your
review evidence as well.

Never invoke native apps, models, schedules, signing, or external services as an
incidental part of these checks. Installation guidance must remain printed
instructions, not a spawned Radius command. Node tests run trusted source with
normal Node privileges: review unfamiliar tests first. `node:vm`, mock host
objects, and a passed schema check do not isolate hostile code.

## What each layer establishes

| Layer | Evidence | Does not establish |
| --- | --- | --- |
| Public SDK / bundle validation | Manifest/schema/path correctness, referenced entries, canonical bundle bytes/digest | App behavior, permission consent, native support |
| Worker unit tests | Calls made to a local host double, JSON results, state/conflict/error logic | Native target capture, broker enforcement, worker isolation |
| View DOM/SDK doubles | Document SDK call shape, receipt handling, text rendering, event refresh/teardown | Actual preload injection, CSP, navigation containment, accessibility/layout in Radius |
| Agent descriptor/prompt tests | Approved scope declarations, local prompt presence, result shape, disabled schedule defaults | Model output safety, budget enforcement, successful generation |
| Host integration / packaged runtime tests | Real host behavior covered by that exact test/build | Other platforms, configurations, or untested features |

The main Radius project owns code-conformance and runtime integration coverage.
App tests in this standalone repo import only `@radius/apps-sdk`, its public
release subpath, local bundle code, and Node builtins; they never reach into
Radius's source tree.

## Test a worker with a local host double

Use public schemas for inputs and outputs, and fail on unexpected host methods:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseAppJson, parseAppManifest, validateAppValue } from '@radius/apps-sdk'
import { readPage } from '../bundle/worker.js'

const manifest = parseAppManifest(parseAppJson(
  await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8'),
))

test('captured metadata is returned as data', async () => {
  const action = manifest.provides.actions.readPage
  validateAppValue(action.inputSchema, {})
  const calls = []
  const output = await readPage({}, { host: { async call(method, input) {
    calls.push({ method, input })
    assert.equal(method, 'tabs.read')
    assert.deepEqual(input, {})
    return { title: '<script>untrusted text</script>', url: 'https://example.com' }
  } } })
  validateAppValue(action.outputSchema, output)
  assert.equal(calls.length, 1)
  assert.equal(output.title, '<script>untrusted text</script>')
})
```

This test exercises the authored function. It does not establish that a native
host has granted access or captured the correct target. A mock throws the error
you configure; that is not proof of real permission enforcement.

For stateful apps, test initial state, isolated instances, concurrent revision
conflicts, corrupt/full state, and a failure after commit. Do not swallow an
event failure or expect rollback after a successful compare-and-set. Include
negative schema cases for missing/extra/oversized inputs. Test no automatic retry
after denial, target expiry, or ambiguous effects.

For views, test that invocation admission is not treated as a result, terminal
errors surface the run ID, untrusted content is rendered as text, event gaps
resynchronize state, and teardown/revocation stops polling. Test absence of the
bridge honestly; do not inject a success fallback into the installed app.

## Current example coverage and gaps

- Reading Queue: worker persistence/isolation, captured metadata, conflict and
  partial-effect handling; view SDK, safe text rendering, event/gap refresh,
  missing/revoked bridge, and teardown. No native capture/bridge proof here.
- Focus Layout: split calls and errors; intended future split/draft sequencing
  and partial failure with a hypothetical mock draft port. The real draft action
  remains blocked before admission. A passing mock does not remove that blocker.
- Morning Brief: manifest/prompt/requirements, configuration compatibility and
  bounds, disabled schedule declaration, and artifact-ID schema; actual view
  controller tests with trusted DOM/SDK doubles cover availability, grants,
  explicit invocation, receipts/cancellation, bounded checking, report access,
  lifecycle teardown, and older-host behavior. No real model calls or generated
  reports are claimed by these unit tests.
- Interactive/background templates: real worker functions with local doubles;
  the interactive template also exercises its view contract.
- Scheduled-agent template: offline descriptor/prompt checks only. No provider,
  budget, scheduler, HTML sanitizer, or artifact-delivery claim is made.

## Native verification is a separate, explicit gate

Honor the active native-display safety hold. Do not launch Radius or capture the
user's screen to complete app unit tests. A future authorized native verification
should record the exact app digest and host build, relevant profile, tested
actions, grant decisions, and remaining gaps. It should check real bridge and
isolation behavior, navigation/captured-target invalidation, state persistence,
revocation, effects/receipt handling, and view accessibility/Reduced Motion.
Agent/schedule verification additionally needs a capable hard-budget profile,
explicit authorization, timezone/day-boundary tests, and artifact/delivery checks.

Screenshots must be actual reviewed captures without unrelated private data.
Empty arrays are preferable to mock screenshots labeled as native operation.
Only mark `ready` after the required evidence is reviewed; schema tests alone
cannot justify it. MIT source publication is approved, but it does not satisfy
native readiness, signing, independent publisher trust or catalog deployment.
Those app-distribution gates remain separate even after local testing succeeds.
