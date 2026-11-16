# Interactive starter

A minimal local view and a permission-free worker action. Native execution is
not verified; the template is experimental. The view never auto-invokes the
action: it first discovers the host, then waits for an explicit form submission.
There are no grants, instances, storage, agents, or schedules.

From the catalog repository root:

```sh
pnpm app create my-hello --template interactive
pnpm app validate my-hello
node --test apps/my-hello/test/*.test.mjs
pnpm app build my-hello
pnpm app install my-hello
```

The last command prints instructions, not an installation. Review the generated
metadata, app ID, name, and version before using it. Once separately installed
by the user on a capable host, open the `main` view or invoke `greet` with
`{ "name": "Ada" }`. No app instance is required.

`worker.js` exports `greet(input, context)` and returns JSON. `ui/app.js` uses
`window.radiusApp.describe()`, `invoke()`, and `getRun()`; admission is not the
final result. It renders output through `textContent`. It does not use Radius
internals or import Node code into the installed view. All runtime assets are
local. See `docs/app-contract.md` in the catalog root for both public surfaces.

You can run the original template tests without creating an app:

```sh
node --test templates/interactive/test/*.test.mjs
```

These are trusted local worker/DOM-double tests, not a security sandbox or native
bridge check. Screenshots are empty because no native capture has been verified.
Version `0.1.1` includes the [MIT license](bundle/LICENSE). Retain the notice in
apps created from this template. Source publication does not establish native
readiness or create a signed/catalog release.
