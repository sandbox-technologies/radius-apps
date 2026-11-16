## App / change

Describe the user-facing problem, affected app/version and why this belongs in
the curated catalog. Link existing discussion if relevant.

## Access and behavior

- Requested requirement IDs and why each action needs them:
- Configuration/state changes and compatibility with existing instances:
- Triggers, agent invocation and artifact delivery (each opt-in separately):
- Unsupported host features and failure/partial-effect behavior:

## Evidence

- [ ] `pnpm check` passes without Radius source, secrets or real model calls.
- [ ] Tests cover denial, invalid input, conflicting state writes and partial effects where relevant.
- [ ] Runtime assets are local and use only public app APIs.
- [ ] Metadata, README and changelog are updated; changed release bytes have a new version.
- [ ] Authorship and license rights are confirmed; no private/personal data or credentials are included.
- [ ] Native validation build/profile and actual screenshots are attached, or the app remains explicitly experimental.
- [ ] No install-time invocation, automatic grants, enabled schedules or implicit agent execution were added.

Do not include signing keys or signed release artifacts in this PR. Publication
is a separate protected maintainer operation. Workflow, SDK, trust and signing
tool changes require designated maintainer review.
