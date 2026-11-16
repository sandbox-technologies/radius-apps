# First public launch checklist

This repository is prepared locally. The following are explicit owner/release
decisions, not actions taken by the scaffolding tools:

- Confirm the GitHub organization and public repository name (`radius-apps`).
- Approve an open-source license for new tooling, extracted app examples and
  the public SDK. Add the actual license text and required notices; replace
  `UNLICENSED` in package/app/template metadata and regenerate the SDK upstream.
- Audit the complete initial commit for secrets, private links, personal data,
  provenance and rights. Publish a new repo without Radius's private Git history.
- Set the default branch to `main`; configure real maintainers/CODEOWNERS,
  required PR review, protected workflow/tooling changes and required CI checks.
- Set up private vulnerability reporting and a real security contact.
- Run the examples on an exact supported Radius/Electron build with a dedicated
  test profile; capture actual screenshots and record availability honestly.
- Configure the protected signing environment, authorized publisher identity,
  public key mapping, key ID and Ed25519 key secret. Do not put keys in Git.
- Configure signing environment reviewers and permitted release branch. GitHub
  workflow files cannot enforce their own environment-review requirements.
- Provision the generated catalog file into the existing Radius website using
  `RADIUS_APPS_CATALOG_FILE`; configure the client catalog HTTPS URL and independent
  trusted public keys. Do not trust keys supplied by a downloaded catalog.
- Test install, update, permission-change consent and signed revocation before
  exposing the catalog to users. Record the exact source commit and bundle digest.

The workflow produces deployable catalog data but does not automatically deploy
the website or register a trusted publisher. That separation is intentional.
