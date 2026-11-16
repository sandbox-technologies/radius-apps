# Release operations

Nothing is published or trusted by bootstrapping this repository. The root, app
metadata and vendored SDK currently say `UNLICENSED`: **signing and catalog
publication are blocked**. An owner must decide licensing/rights, repository
identity, maintainers, host support/readiness, and independent public-key trust
before any release. Do not "fix" a gate by silently choosing a license or key.
Unsigned preparation is allowed with pending licenses. No screenshots, native
launch, models, permissions or schedules are required by these commands.

## Trust boundaries

`prepare` snapshots data and checks every bundle byte against a full, local Git
commit. It requires clean `HEAD` (including untracked files), tracked metadata,
and an explicitly supplied credential-free HTTPS repository identity matching
`remote.origin.url`. It never fetches. Configure a real remote only after owner
approval; a fresh repository without commits/origin cannot claim provenance.
Use a clean release checkout with reviewed tools. Do not use a contributor's
modified release tooling as your signer.

`sign` reads only data, re-creates that exact source snapshot, verifies every SDK
output against `SOURCE.json` and the committed bytes, checks licenses, and
requires SDK `sourceTreeDirty` to be exactly `false`. A missing/true marker is
not a release-quality SDK export. The SDK's recorded upstream identity/hashes
are reviewed provenance claims, not an online upstream authenticity check.
No app JavaScript, tests, install hooks or package manager runs in the signer.
The explicit private key must be an unencrypted Ed25519 PEM, an owner-private
regular file (for example mode `0600`), without symlinks/hard links, outside the
checkout and artifact directories. The public key must independently match
the trusted publisher/key mapping; it is never accepted from a release.

All input files have byte/complexity limits; all outputs are new and outside the
source checkout. Existing outputs, including symlinks, are never replaced. Use
private operator-owned parent directories: these tools do not sandbox hostile
processes running under the same OS user. No network operations or deployment
are implemented.

## Offline commands

After dependencies were installed with `pnpm install --ignore-scripts
--frozen-lockfile`, use Node directly. `REPO_URL`, `COMMIT`, `PUBLISHER`, `KEY_ID`
and paths below are explicit operator choices, not examples of approved values.
Use a full 40- or 64-character commit hash, never a branch/tag. Create private
external work/key directories yourself; do not put key material in this repo.

```sh
node tooling/release.mjs prepare \
  --repo "$PWD" --app reading-queue --repository "$REPO_URL" \
  --commit "$COMMIT" --publisher "$PUBLISHER" --out "$WORK/prepared.json"

node tooling/release.mjs sign \
  --repo "$PWD" --prepared "$WORK/prepared.json" \
  --repository "$REPO_URL" --commit "$COMMIT" --key-id "$KEY_ID" \
  --private-key "$KEY_DIRECTORY/release.pem" \
  --trusted-keys "$TRUSTED_KEYS" --out "$WORK/signed"
```

The public-key file is a bounded JSON map of
`keyId: { publisherId, publicKeyPem }`. `catalog/trusted-keys.json` starts empty;
adding a real trust key is an explicit owner/security decision. Consumers must
provision their own trust roots separately, never download trust from a catalog.

Signing emits two immutable files:

- `release.json`: the unmodified host envelope
  `{schemaVersion:1,keyId,payload,signature}`. Ed25519 signs the UTF-8 Radius
  canonical JSON payload `{appId,version,apiVersion,publisherId,digest,files}`.
  The digest hashes the full canonical base64 file map, including original
  `radius-app.json` bytes. Source/author metadata is not silently added to this
  strict host wire format.
- `provenance.json`: a separate Ed25519 envelope. The signing message is
  `radius.apps/source-provenance/1\n` followed by canonical JSON of its payload.
  This binds the canonical signed release's SHA-256, repository, exact clean
  commit, app/bundle paths, release identities, app metadata hash, SDK SOURCE
  hash/version/cleanliness and license declarations. This tool verifies it;
  the current native host only verifies the original release envelope.

## Append-only catalog updates

Keep both `operator.json` and `sources.json` from the last published catalog.
Use that directory as `--previous`. The initial empty files in `catalog/` are
**only for the first release**. Independently pin the current state's SHA-256
in release records/environment configuration; never automatically adopt a
hash supplied alongside a newly downloaded baseline. To inspect a local state:

```sh
node --input-type=module -e '
  import { readCatalogState, catalogStateDigest } from "./tooling/release-catalog.mjs";
  console.log(catalogStateDigest(await readCatalogState(process.argv[1])));
' "$PREVIOUS_CATALOG"

node tooling/release.mjs catalog \
  --repo "$PWD" --release "$WORK/signed" --repository "$REPO_URL" \
  --commit "$COMMIT" --trusted-keys "$TRUSTED_KEYS" \
  --previous "$PREVIOUS_CATALOG" --previous-sha256 "$EXPECTED_BASELINE_SHA256" \
  --out "$WORK/catalog"
```

The state hash covers canonical `{operator,sources}`. Every previous release,
source statement and revocation is verified with independent trusted keys;
historical envelopes are retained without mutation. Changing an existing
publisher/app/version's bytes, signature, source statement, or revocation is
rejected. New app versions must have strictly increasing SemVer precedence;
build metadata alone is not an increase. Limits are 64 releases, 256
revocations, 32 MiB operator data and 2 MiB discovery/revocation responses.
Reaching a limit blocks the update; this tool does not prune security history.

Optionally add `--revocations "$SIGNED_REVOCATION_ARRAY"` (a JSON array).
These must already be signed using the host's domain-separated revocation
format; the SDK's exact `verifyAppRevocation` verifies them. This CLI does not
create revocation signatures. Re-supply the identical signed release and its
original clean checkout to append revocations without issuing a new version.
Previously revoked releases remain in history; the host revocation mechanism
controls admission. A newly added release cannot already be revoked.

Outputs include `operator.json`, `sources.json`, `state.json` (next baseline
hash), discovery summaries, signed digest files, revocations, and `routes.json`.
The operator file is exactly `{schemaVersion:1,releases:[],revocations:[]}` for
the existing website's `RADIUS_APPS_CATALOG_FILE`. Alternatively an operator can
map `routes.json` to exact `/api/radius-apps`, `/api/radius-apps/releases/<digest>`
and `/api/radius-apps/revocations` responses, with `application/json`, no redirects
and fresh revocation/discovery responses. Merely uploading a static directory
does not implement these extensionless routes. Provenance sidecars stay outside
the strict host API. Retain them with the operator file and release records.

There is no signed catalog sequence/checkpoint in the current host protocol.
The tool detects a baseline mismatch and version rollback **relative to the
independently pinned operator state**. It cannot detect an operator deliberately
re-pinning an old state, or a server replaying an old catalog to a fresh client.
Keep monotonic release records, current revocations and independent deployment
review; do not claim global cryptographic rollback prevention.

## GitHub Actions (configuration still required)

`validate.yml` runs contributor JavaScript only on ephemeral hosted runners,
with read-only repository permissions, no protected environment/signing
secrets, no persisted checkout credentials, no dependency lifecycle hooks and
no cache/artifact path into signing. It checks out the event's exact SHA.
Untrusted tests are not a sandbox: do not use credential-bearing/self-hosted
runners. Never replace this with `pull_request_target` or a privileged
`workflow_run` consuming PR code/artifacts.

`release.yml` is manual and accepts a slug plus reviewed full commit. Both jobs
require the workflow to run on the repository's default branch and the reviewed
commit to equal `github.sha`; there is no arbitrary checkout-ref input. The
first job tests/prepares without signing secrets. A fresh second job checks out
the same pinned reviewed tooling and revalidates the unsigned artifact. Only
one data-signing step sees the external key, removes it in `finally`, and strips
it from the child process environment. No dependency installation/app tests run
in that job. Signed/catalog artifacts are uploaded, not deployed or committed.

Before enabling it, owners must:

1. Protect the default branch and require review of workflow/tooling/SDK/trust
   changes. Set `validate.yml`'s push branch if the chosen branch is not `main`.
2. Configure `release-signing` with required reviewers, prevent self-review,
   restrict deployments to the protected default branch, and disable bypass
   where supported. The YAML cannot enforce repository/environment settings.
   Verify the plan supports those protections before storing a secret; otherwise
   keep signing offline. Do not store signing keys as repository-wide secrets.
3. Set repository variable `RADIUS_APPS_PUBLISHER_ID`; environment variables
   `RADIUS_APPS_KEY_ID` and independently reviewed
   `RADIUS_APPS_CATALOG_STATE_SHA256`; and environment-only secret
   `RADIUS_APPS_ED25519_PRIVATE_KEY_PEM`. Provision reviewed public keys separately.
4. Resolve all license gates, regenerate the SDK from a clean committed upstream,
   review app readiness/permissions and unsupported native/agent behavior, then
   dispatch the exact reviewed default-branch commit. Approvers check that SHA
   and artifact digest before authorizing the environment.
5. Review the output, provision the website catalog separately, archive source
   provenance, preserve the new baseline files, and advance the independently
   stored baseline hash before the next release. This repo has no deployment job.

Action pins were checked against GitHub's primary Git reference and commit APIs
on November 16, 2026; each resolved commit reported `verification.verified: true`:
`actions/checkout` v4.3.1 (`34e114876b0b11c390a56381ad16ebd13914f8d5`),
`actions/setup-node` v4.4.0 (`49933ea5288caeca8642d1e84afbd3f7d6820020`),
`actions/upload-artifact` v4.6.2 (`ea165f8d65b6e75b540449e92b4886f43607fa02`),
`actions/download-artifact` v4.3.0 (`d3f86a106a0bac45b974a628896c90dbdf5c8093`).
These are reviewed fixed pins, not a claim that they are the latest releases.
