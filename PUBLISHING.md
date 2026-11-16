# Public source publication and app distribution

The owner has approved **public source publication under MIT** at the canonical
repository
[sandbox-technologies/radius-apps](https://github.com/sandbox-technologies/radius-apps).
The [root license](LICENSE), app/template metadata and packaged license notices
reflect that decision. The generated SDK is MIT-licensed version
`0.1.0-experimental.2`; its license and provenance come from the upstream exporter,
not hand-edits to the vendored output.

The public GitHub repository has been created and private vulnerability reporting
has been enabled and verified. Only reviewed, licensed and tested source belongs
on `main`; these settings do not publish apps.

## Source-publication checks

Publication operators should verify the following configuration and evidence;
this checklist does not claim those operations have been completed:

- Audit the complete source snapshot and standalone Git history for secrets,
  private links, personal data, provenance and rights. Do not publish Radius's
  private Git history.
- Verify MIT notices in the root, each app/template bundle and the generated SDK.
  Run the standalone validation, test and build checks on the reviewed commit.
- Set the default branch to `main`; configure real maintainers/CODEOWNERS,
  required PR review, protected workflow/tooling changes and required CI checks.
- Preserve the verified private vulnerability reporting configuration and keep
  [SECURITY.md](SECURITY.md) accurate. The Security tab's **Report a vulnerability**
  action is the reporting channel; no monitored email address is claimed.

## Separate app-distribution gates

No signed/catalog release, deployed catalog, configured trusted publisher keys
or live Radius UI validation exists. These remaining gates apply to official app
distribution, not the already approved MIT source publication:

- Run the examples on an exact supported Radius/Electron build with a dedicated
  test profile; capture actual screenshots and record availability honestly.
- Keep current apps experimental. Agent generation and the Focus Layout draft
  action remain blocked until their host requirements are implemented and verified.
- Configure the protected signing environment, authorized publisher identity,
  public key mapping, key ID and Ed25519 key secret. Do not put keys in Git.
- Configure signing environment reviewers and permitted release branch. GitHub
  workflow files cannot enforce their own environment-review requirements.
- Provision the generated catalog file into the existing Radius website using
  `RADIUS_APPS_CATALOG_FILE`; configure the client catalog HTTPS URL and independent
  trusted public keys. Do not trust keys supplied by a downloaded catalog.
- Test install, update, permission-change consent and signed revocation before
  exposing the catalog to users. Record the exact source commit and bundle digest.

Once separately configured and approved, the release workflow can produce
deployable catalog data; it does not automatically deploy the website or register
a trusted publisher. Public source and MIT licensing do not grant permissions,
enable schedules, run models or make an unsigned source checkout trusted.
