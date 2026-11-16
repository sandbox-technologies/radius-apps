# Contributing a Radius app

The canonical repository is
[sandbox-technologies/radius-apps](https://github.com/sandbox-technologies/radius-apps),
approved for public source publication under the [MIT License](LICENSE).
Submit focused pull requests with code you have the right to contribute under
MIT, and retain the license and copyright notices, including `bundle/LICENSE`.
MIT source publication does not establish native readiness or authorize signed
app/catalog distribution.

## Authoring loop

1. Start with `pnpm app create <slug> --template interactive` (or
   `background-action` / `scheduled-agent`).
2. Edit `apps/<slug>/bundle/radius-app.json` and local assets. Define narrow
   requirement IDs and attach only needed requirements to each action.
3. Document purpose, setup, configuration, requested capabilities and failure
   behavior in the app README. Keep app metadata in `app.json`, outside the bundle.
4. Add tests for successful calls, invalid inputs, isolation, CAS conflicts and
   effects that commit before another step fails. Never silently retry ambiguous
   writes or run real agents during tests.
5. Run `pnpm check`. If native testing is separately authorized, install into an
   isolated Radius test profile and record the exact host build and supported/
   unsupported actions. Otherwise record native validation as pending; source
   contributions can remain experimental.
6. Submit a focused PR containing source, tests, changelog and permission changes.

## Review criteria

- Clear user value and a small, understandable permission request.
- Only public SDK/host operations; no browser-private imports or privileged path.
- Local packaged executable assets; no external code, install hooks or native binaries.
- Configuration and instance state stay separate; persistence uses revisioned host storage.
- Selected-page actions use captured invocation context, never current focus.
- App pages render untrusted content as text and handle cancellation/revocation.
- Schedules and agent invocation are separate opt-ins; no install-time effects.
- No credentials, personal data, browsing history or private links in fixtures or screenshots.
- Authorship/license rights confirmed, changelog updated, version incremented for changed release bytes.
- Genuine screenshots and native validation evidence before moving to ready status.

Tests execute contributor JavaScript under Node and are not a sandbox. Review
unknown contributions before running them on your workstation. CI uses an
ephemeral runner without signing secrets. Never check out a PR into a job with
publisher credentials, or use `pull_request_target` to run its code.

Maintainers configure review ownership and required checks using
[PUBLISHING.md](PUBLISHING.md). Do not add pretend
CODEOWNERS usernames as a substitute for actual protected review settings.
