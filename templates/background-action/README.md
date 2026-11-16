# Background-action starter

A view-free worker action for an explicit invocation. "Background" means no
interactive app view, not an always-running process, automatic trigger, or
permission to run at startup. This experimental template has no instance,
storage, schedule, native executable, or agent.

```sh
pnpm app create my-page-action --template background-action
pnpm app validate my-page-action
node --test apps/my-page-action/test/*.test.mjs
pnpm app build my-page-action
pnpm app install my-page-action
```

Run commands from the catalog root. The install helper prints a manual command
and does not invoke Radius or grant access. Review the generated app ID/name and
metadata. Before native use, the user must separately install, approve
`selectedPage`, and capture a tab context. Invoke `readPage` with `{}` and that
fresh caller-bound context handle. See `docs/permissions.md` in the catalog root.

The sole requirement is `tabs.read` with
`{ "target": "invocation", "fields": ["title", "url"] }`. The worker calls
`context.host.call('tabs.read', {})`. It reads only metadata supplied by the host;
it does not select current focus, fetch a URL, read a page body, or navigate.
It returns `{ "title": "…", "url": "…" }` as data. Consumers must render these
untrusted strings as text. Permission, expiry, and navigation errors propagate
without choosing another target or retrying automatically.

Run the template tests directly with
`node --test templates/background-action/test/*.test.mjs`. These call the worker
against a local mock host and validate schemas; they do not establish native
capture or sandbox safety. Native verification is pending. Screenshots are
empty because no native capture was performed and this action has no view.
Version `0.1.1` includes the [MIT license](bundle/LICENSE). Retain the notice in
apps created from this template. Source publication does not establish native
readiness or create a signed/catalog release.
