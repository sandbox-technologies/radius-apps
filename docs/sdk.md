# Public SDK dependency

`@radius/apps-sdk` version `0.1.0-experimental.2` is installed from
`vendor/apps-sdk` with a locked local file dependency. It has no npm runtime
dependencies, package-manager hooks, network fetches or Radius source imports.
The generated ESM is readable. Its default entry is browser-safe; the `release`
entry uses Node crypto for offline bundle/signature verification.

The SDK is MIT-licensed and includes the generated
[license notice](../vendor/apps-sdk/LICENSE). Its clean upstream export is from
commit `4384b70d17709f32bcd41ff7a461d05dde294ec9`; the versioned
[provenance record](../vendor/apps-sdk/SOURCE.json) identifies its source and output
hashes. SDK licensing does not make the experimental host's blocked generation
or draft capabilities available.

The source of truth remains Radius. The upstream
`packages/radius-app-sdk/scripts/export.mjs` bundles the authoritative schema,
manifest, canonical-JSON, digest and signature algorithms into a standalone
distribution. This avoids a separately maintained approximation of validation.

`vendor/apps-sdk/SOURCE.json` records the upstream commit, relevant source hashes,
compiler versions and every generated output hash. A `sourceTreeDirty` value of
true identifies an uncommitted development export, not a reproducible release.
Only clean, reviewed exports belong in published releases. No local absolute
paths, source maps, native runtime or publisher keys are exported.

## Using it

Authoring tools can import `parseAppManifest`, `validateAppValue` and the release
verifier. Editor types include `AppManifest`, `AppHandler`, `AppWorkerContext`,
`RadiusAppView` and the deliberately restricted run-receipt shape.

Actual runtime bundles contain only local files. Examples use the host-provided
`window.radiusApp` directly; package names do not magically resolve in app
workers or pages. If you use a dependency, bundle it into local files yourself
and review what it adds. The scaffold does not execute build hooks from apps.

`getRadiusApp()` is a convenience accessor, not a security check or a fake
browser bridge. Outside an installed Radius app it fails with
`CAPABILITY_UNAVAILABLE`. It never grants access, installs an app or falls back
to arbitrary IPC.

## Updating

Have the runtime maintainer export a new package version from a committed Radius
revision. Review API/permission changes and replace the vendored directory as a
single dependency update. Run `pnpm install --ignore-scripts` to update the lock
and then `pnpm check`. The upstream conformance suite compares public outputs
with the actual host validator and install path. App contributors do not need
access to the upstream source repository.

Registry distribution can replace this local-file dependency after publishing
and namespace ownership are configured. Do not point consumers at an imaginary
package release before it exists.
