# Radius Apps

The standalone home for curated Radius apps, runnable examples and developer
templates. Apps use the public `radius.apps/1` contract; they do not import
browser internals. Radius owns execution, permissions, profiles and persistence.

**Experimental, pre-publication scaffold.** The repository owner and open-source
license still need approval. `UNLICENSED` is a deliberate publication gate, not
an open-source license. No public repository, deployed catalog or trusted
publisher is created by checking out or running this project.

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
signing credentials. A separate protected maintainer workflow creates immutable
Ed25519-signed bundles and signed source provenance, then builds the hosted
catalog input. GitHub source is not itself an installable trusted release, and
curation never replaces the user's permission consent.

Read [release operations](docs/releasing.md) and the
[publication checklist](PUBLISHING.md) before making this repository public.
Personal/local apps do not need to be published here. Report security issues
using [SECURITY.md](SECURITY.md).
