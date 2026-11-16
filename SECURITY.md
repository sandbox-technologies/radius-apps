# Security

Apps are untrusted inputs even when their source is public and reviewed.
Radius's runtime and installation grants are the security boundary; this repo
is the source/release workflow, not a replacement sandbox.

Never commit private signing keys, API credentials, user profile files or real
activity histories. Test keys must be generated ephemerally. The release job
must not execute contributor app modules or package hooks with signing secrets.

## Reporting

Private vulnerability reporting is enabled for the canonical
`sandbox-technologies/radius-apps` repository. Use
[Report a vulnerability](https://github.com/sandbox-technologies/radius-apps/security/advisories/new)
or open the repository's **Security** tab and select **Report a vulnerability**.

If you cannot access private reporting, contact the repository owner through an
existing private channel. Do not create a public issue with exploitation steps,
keys or user data. No monitored email address is claimed here.

## Withdrawal

Withdraw compromised release digests with the host's separately signed,
domain-separated revocation format. Preserve the existing revocation list on
every catalog rebuild. Removing a GitHub folder or a catalog listing alone does
not revoke an installed app. Offline hosts learn new revocations only when they
refresh; do not claim continuous remote disablement.

Host-level issues (permission checks, worker isolation, view binding, profile
ownership) belong in Radius's security process as well as the app's release
response. See [release operations](docs/releasing.md).
