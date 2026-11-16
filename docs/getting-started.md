# Build your first Radius app

You can author, validate, test, and package an app without a Radius source
checkout, native UI, model credentials, or signing keys. Using an installed app
requires a compatible Radius host advertising `apps.call: 1`. The current apps
are experimental; local test success is not a native-readiness claim.

## Set up the standalone repository

Use Node 22 or newer and pnpm 10.24 or newer. From the repository root:

```sh
pnpm install --ignore-scripts --frozen-lockfile
pnpm check
```

The only package dependency is the generated, vendored public SDK. No private
package registry or Radius source import is needed. Do not hand-edit that SDK;
see [SDK provenance](sdk.md). Tests execute trusted contributor code in Node;
review unfamiliar code before running it.

## Start with Reading Queue

```sh
pnpm app validate reading-queue
node --test apps/reading-queue/test/*.test.mjs
pnpm app build reading-queue
pnpm app install reading-queue
```

`validate` checks metadata and bundle data. Tests execute the local worker/view
doubles. `build` materializes the bundle at `dist/apps/reading-queue`; it does
not execute an app build script. `install` builds locally and prints manual
review/install commands, including an expected digest and no grants. It never
launches Radius, installs an app, invokes an agent, or enables a schedule.

The source structure is:

```text
apps/reading-queue/
  app.json                 Catalog metadata, not the runtime manifest
  README.md                Usage, permissions, and current limitations
  CHANGELOG.md             App-version history
  bundle/
    radius-app.json        Schema-2 public runtime manifest
    worker.js              Local worker exports
    ui/                    Local view HTML, JavaScript, and CSS
  test/                    Trusted Node tests, not installed assets
```

Only `bundle/` is installed. Metadata, screenshots outside the bundle, authoring
tests, and package-manager files are not runtime code. See
[the app contract](app-contract.md) for file/path and schema rules.

## Optional manual use in Radius

Do this only when the user explicitly chooses to use an already running,
compatible Radius instance. Honor any native-display/testing hold. The commands
printed by `pnpm app install reading-queue` first review the bundle and then
install exactly its digest without grants or agent invocation permission.
Select the intended Radius profile explicitly when more than one is available.

An install with no grants cannot access queue state. For a direct-entry queue,
after reviewing the requirement, the user may explicitly change the printed
installation command to `--grant queueState`. Add `selectedPage` only if captured
tab metadata access is desired. Do not approve all requirements automatically.

After installation, replace `install_queue` with the returned installation ID:

```sh
radius apps call instances.create --input '{"installationId":"install_queue","configuration":{"title":"Weekend reading"}}' --json
```

Replace `instance_queue` with the returned instance ID before continuing:

```sh
radius apps open install_queue main --app-instance instance_queue
radius apps invoke install_queue add --app-instance instance_queue --input '{"title":"Example article","url":"https://example.com/article"}' --idempotency-key example-article-1 --json
```

An invocation returns a run handle, not necessarily a completed result. Replace
`run_example` with that returned run ID and inspect its receipt:

```sh
radius apps run run_example --json
radius apps invoke install_queue list --app-instance instance_queue --json
```

The second invocation also has its own run receipt. Inspect failures and effects
before retrying a write: storage may have committed even if event delivery
failed. The view and CLI share the same host-owned instance state.

For captured-page actions, see [permissions](permissions.md). A CLI-issued
context handle cannot be transferred to the view. If the host does not offer a
view-specific target picker, use the direct-entry form.

## Create a new app

```sh
pnpm app create my-hello --template interactive
pnpm app validate my-hello
node --test apps/my-hello/test/*.test.mjs
pnpm app build my-hello
pnpm app install my-hello
```

Creation produces a new `apps/my-hello` directory and a local app identity.
It does not overwrite an existing app. Edit the generated metadata, author name,
app name/ID, README and changelog before review. Update view copy too; a generated
manifest name is not a universal search-and-replace of runtime assets. App IDs
identify installations and must remain stable after release.

Choose one of three independent templates:

- [interactive](../templates/interactive/README.md): permission-free greeting
  worker plus a document-bound view. Good for learning the worker/view boundary.
- [background-action](../templates/background-action/README.md): explicitly
  invoked captured-page metadata action, with no view or persistent process.
- [scheduled-agent](../templates/scheduled-agent/README.md): local prompt and
  disabled-by-default schedule declaration. Native generation is blocked; use
  it to validate the contract, not to produce a report on the current host.

The original template suites also run directly:

```sh
node --test templates/*/test/*.test.mjs
```

No new dependencies are needed for these starters. Keep runtime modules local;
bare npm imports do not resolve inside installed workers/views.

## Before contributing

Run the [testing checklist](testing.md), document requested access and remaining
native gaps, and keep `status: "experimental"` until native evidence is reviewed.
All initial screenshot arrays are empty because no native captures have been
verified. Do not manufacture screenshots or claim a mock view is native evidence.

Read [CONTRIBUTING.md](../CONTRIBUTING.md). `UNLICENSED` is intentionally pending
an owner decision; this walkthrough does not authorize publication, a license
grant, signing, pushing, or a GitHub change. Contribution checks and maintainer
release/signing are separate workflows; see [releasing](releasing.md).
