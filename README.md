# Radius Apps

The standalone home for curated Radius apps, runnable examples and developer
templates. Apps use the public `radius.apps/1` contract; they do not import
browser internals. Radius owns execution, permissions, profiles and persistence.

The canonical public source repository is
[sandbox-technologies/radius-apps](https://github.com/sandbox-technologies/radius-apps).
The source, reference apps, templates and generated SDK are licensed under
[MIT](LICENSE); each app/template bundle includes its own license notice.

App distribution remains experimental. No signed/catalog release or catalog
deployment exists, no trusted publisher keys are configured, and no live Radius
UI validation has been completed. Public source publication does not remove
those distribution gates or enable blocked host capabilities.

## Start here

Use Node 22 or newer and pnpm 10.24 or newer. A Radius source checkout, private
registry access, signing key, browser launch and model credentials are not
required to build and test an app:

```sh
pnpm install --ignore-scripts --frozen-lockfile
pnpm check
pnpm app build reading-queue
pnpm app install reading-queue
```

The last command prints the manual Radius CLI installation command. It does not
launch Radius, install anything, approve permissions or enable a schedule. The
installable bundle is `dist/apps/reading-queue`; metadata and tests stay outside
it. A compatible Radius build with experimental Apps enabled is needed only to
actually install and use the app. See [getting started](docs/getting-started.md).

Create your own example:

```sh
pnpm app create my-app --template interactive
pnpm app validate my-app
pnpm app build my-app
```

## Reference apps

- [Reading Queue](apps/reading-queue/README.md): an interactive tab, private
  instance state, typed actions, revisioned writes and events.
- [Focus Layout](apps/focus-layout/README.md): actions scoped to a captured tab.
  Split-only is implemented; the draft action is unavailable on the current host.
- [Morning Brief](apps/morning-brief/README.md): scheduled-agent and saved-HTML
  artifact design. Generation remains unavailable until the host can enforce its
  usage budget. Installing never starts it or enables a schedule.

All are marked experimental pending native Radius validation. Tests with mock
host calls do not certify Electron isolation or production availability.

## What belongs here

- `apps/`: curated source, manifests, tests and contributor metadata.
- `templates/`: interactive, background-action and scheduled-agent starting points.
- `tooling/`: standalone validation, packaging, release and catalog commands.
- `vendor/apps-sdk/`: a versioned, readable, generated public contract snapshot.
- `catalog/`: release policy and operator data, not private signing keys.
- `docs/`: authoring, permissions, testing and release instructions.

The SDK comes from the same validator Radius enforces. This first version is
vendored so no unpublished npm package or browser checkout is needed; see
[SDK provenance](docs/sdk.md). App runtime code is plain local ESM and uses
`context.host.call` in workers or `window.radiusApp` in views. No Node imports,
arbitrary IPC, remote modules or install scripts are available inside an app.

## Contribute and release

Read [CONTRIBUTING.md](CONTRIBUTING.md), [the public contract](docs/app-contract.md),
[permissions](docs/permissions.md), and [testing](docs/testing.md).

Contributions are reviewed as pull requests. CI validates and tests without
signing credentials. A separate maintainer workflow is provided for immutable
Ed25519-signed bundles, signed source provenance and hosted catalog input; its
protected signing environment and independent trust configuration still require
setup and approval. GitHub source is not itself an installable trusted release,
and curation never replaces the user's permission consent.

Read [release operations](docs/releasing.md) and the
[publication checklist](PUBLISHING.md) for the separate source-publication and
app-distribution requirements.
Personal/local apps do not need to be published here. Report security issues
using [SECURITY.md](SECURITY.md).
