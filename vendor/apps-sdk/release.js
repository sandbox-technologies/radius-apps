// Generated public Radius Apps SDK. See SOURCE.json; update upstream, not this file.
import {
  APP_API_VERSION,
  APP_LIMITS,
  APP_MANIFEST_LIMITS,
  AppContractError,
  canonicalAppJson,
  parseAppJson,
  parseAppManifest,
  validateAppBundlePath
} from "./chunk-SGLIVKCF.js";

// radius/src/main/features/apps/release-verification.ts
import { createHash, createPublicKey, verify } from "node:crypto";
var own = (v, k) => Object.hasOwn(v, k);
function reject(message) {
  throw new AppContractError("INVALID_ARGUMENT", message);
}
function check(ok, message) {
  if (!ok) reject(message);
}
function record(value, fields) {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Expected release object");
  const result = value;
  if (fields) check(Object.keys(result).length === fields.length && fields.every((k) => own(result, k)), "Invalid release fields");
  return result;
}
function decodeAppBase64(value, maximum) {
  check(typeof value === "string", "Expected base64 file");
  if (value.length > Math.ceil(maximum / 3) * 4) throw new AppContractError("LIMIT_EXCEEDED", "Encoded file exceeds limit");
  check(value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), "Invalid base64 encoding");
  const bytes = Buffer.from(value, "base64");
  check(bytes.toString("base64") === value, "Noncanonical base64 encoding");
  if (bytes.length > maximum) throw new AppContractError("LIMIT_EXCEEDED", "Expanded file exceeds limit");
  return bytes;
}
function decodeAppText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return reject("App text must be valid UTF-8");
  }
}
function appBundleDigest(files) {
  return createHash("sha256").update(canonicalAppJson(files), "utf8").digest("hex");
}
function validateAppBundleFiles(value) {
  const files = record(parseAppJson(canonicalAppJson(value)));
  const names = Object.keys(files);
  check(names.length > 0 && names.length <= APP_LIMITS.bundleFiles, "Invalid bundle file count");
  const paths = /* @__PURE__ */ new Map();
  const directories = /* @__PURE__ */ new Set();
  let expanded = 0;
  const decoded = /* @__PURE__ */ new Map();
  for (const name of names) {
    validateAppBundlePath(name);
    const segments = name.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const path = segments.slice(0, i).join("/");
      const folded = path.toLowerCase();
      check(!paths.has(folded) || paths.get(folded) === path, "Case-colliding bundle paths");
      paths.set(folded, path);
      if (i < segments.length) directories.add(path);
    }
    const bytes = decodeAppBase64(files[name], APP_LIMITS.bundleFileBytes);
    expanded += bytes.length;
    if (expanded > APP_LIMITS.bundleBytes) throw new AppContractError("LIMIT_EXCEEDED", "Expanded bundle exceeds limit");
    decoded.set(name, bytes);
  }
  for (const name of names) check(!directories.has(name), "File/directory path collision");
  check(own(files, "radius-app.json"), "Missing radius-app.json");
  const rawManifest = decoded.get("radius-app.json");
  check(rawManifest, "Missing radius-app.json");
  if (rawManifest.length > APP_MANIFEST_LIMITS.bytes) throw new AppContractError("LIMIT_EXCEEDED", "Manifest exceeds limit");
  const manifest = parseAppManifest(parseAppJson(decodeAppText(rawManifest)));
  const textEntries = [manifest.worker?.entry, ...Object.values(manifest.provides.views).map((v) => v.entry), ...Object.values(manifest.provides.actions).flatMap((a) => a.implementation.kind === "agent" ? [a.implementation.prompt] : [])].filter((p) => p !== void 0);
  for (const path of textEntries) {
    const bytes = decoded.get(path);
    check(bytes, `Missing bundle entry: ${path}`);
    const text = decodeAppText(bytes);
    check(text.trim().length > 0 && !text.includes("\0"), "Empty/binary app entry");
  }
  if (manifest.icon) check(own(files, manifest.icon), "Missing bundle icon");
  return { files, manifest, digest: appBundleDigest(files) };
}
function freezeAppBundle(bundle) {
  const freeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(bundle);
  return bundle;
}
function verifyAppCatalogRelease(envelope, keys) {
  const e = record(parseAppJson(canonicalAppJson(envelope)), ["schemaVersion", "keyId", "payload", "signature"]);
  check(e.schemaVersion === 1, "Unsupported catalog envelope");
  check(typeof e.keyId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(e.keyId), "Invalid signing key ID");
  const p = record(e.payload, ["appId", "version", "apiVersion", "publisherId", "digest", "files"]);
  check(typeof p.publisherId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p.publisherId), "Invalid publisher ID");
  check(typeof p.digest === "string" && /^[a-f0-9]{64}$/.test(p.digest), "Invalid release digest");
  if (!own(keys, e.keyId)) throw new AppContractError("PERMISSION_DENIED", "Untrusted catalog signing key");
  const trusted = keys[e.keyId];
  if (!trusted || trusted.publisherId !== p.publisherId) throw new AppContractError("PERMISSION_DENIED", "Signing key is not trusted for publisher");
  const signature = decodeAppBase64(e.signature, 64);
  check(signature.length === 64, "Invalid Ed25519 signature length");
  let authenticated = false;
  try {
    check(typeof trusted.publicKeyPem === "string" && trusted.publicKeyPem.length <= 8192 && trusted.publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----"), "Expected host public key PEM");
    const key = createPublicKey(trusted.publicKeyPem);
    check(key.asymmetricKeyType === "ed25519", "Expected Ed25519 public key");
    authenticated = verify(null, Buffer.from(canonicalAppJson(p), "utf8"), key, signature);
  } catch {
    throw new AppContractError("PERMISSION_DENIED", "Invalid catalog signing key/signature");
  }
  if (!authenticated) throw new AppContractError("PERMISSION_DENIED", "Invalid catalog signature");
  const snapshot = validateAppBundleFiles(p.files);
  check(snapshot.digest === p.digest, "Catalog bundle digest mismatch");
  check(p.appId === snapshot.manifest.id && p.version === snapshot.manifest.version, "Catalog identity/version mismatch");
  if (p.apiVersion !== APP_API_VERSION || p.apiVersion !== snapshot.manifest.apiVersion) throw new AppContractError("INCOMPATIBLE_API", "Catalog API mismatch");
  return freezeAppBundle({ ...snapshot, source: { kind: "catalog", publisherId: p.publisherId, keyId: e.keyId } });
}

// radius/src/main/features/apps/revocation.ts
import { createPublicKey as createPublicKey2, verify as verify2 } from "node:crypto";
function valid(ok) {
  if (!ok) throw new AppContractError("INVALID_ARGUMENT", "Invalid app release revocation");
}
function object(value, keys) {
  valid(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
  return value;
}
function appRevocationSigningMessage(payload) {
  return Buffer.from(`radius.apps/revocation/1
${canonicalAppJson(payload)}`, "utf8");
}
function parseAppRevocation(value) {
  const serialized = canonicalAppJson(value);
  valid(Buffer.byteLength(serialized) <= 16 * 1024);
  const envelope = object(parseAppJson(serialized), ["schemaVersion", "keyId", "signature", "payload"]);
  const identity = (value2) => typeof value2 === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value2);
  valid(envelope.schemaVersion === 1 && identity(envelope.keyId) && typeof envelope.signature === "string" && decodeAppBase64(envelope.signature, 64).length === 64);
  const payload = object(envelope.payload, ["publisherId", "appId", "digest", "revokedAt", "reason"]);
  valid(identity(payload.publisherId) && typeof payload.appId === "string" && /^[a-z][a-z0-9.-]{0,127}$/.test(payload.appId));
  valid(typeof payload.digest === "string" && /^[a-f0-9]{64}$/.test(payload.digest));
  valid(typeof payload.revokedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.revokedAt) && Number.isFinite(Date.parse(payload.revokedAt)) && new Date(payload.revokedAt).toISOString() === payload.revokedAt);
  valid(typeof payload.reason === "string" && payload.reason.length > 0 && payload.reason.length <= 1e3 && !/\p{Cc}/u.test(payload.reason));
  return { schemaVersion: 1, keyId: envelope.keyId, signature: envelope.signature, payload: { publisherId: payload.publisherId, appId: payload.appId, digest: payload.digest, revokedAt: payload.revokedAt, reason: payload.reason } };
}
function verifyAppRevocation(value, keys) {
  const envelope = parseAppRevocation(value);
  const key = Object.hasOwn(keys, envelope.keyId) ? keys[envelope.keyId] : void 0;
  if (!key || key.publisherId !== envelope.payload.publisherId) throw new AppContractError("PERMISSION_DENIED", "Revocation signer is not trusted for this publisher");
  try {
    const publicKey = createPublicKey2(key.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519" || !verify2(null, appRevocationSigningMessage(envelope.payload), publicKey, decodeAppBase64(envelope.signature, 64))) throw new Error("Invalid signature");
  } catch {
    throw new AppContractError("PERMISSION_DENIED", "Revocation signature verification failed");
  }
  return envelope.payload;
}
export {
  appBundleDigest,
  appRevocationSigningMessage,
  decodeAppBase64,
  decodeAppText,
  parseAppRevocation,
  validateAppBundleFiles,
  verifyAppCatalogRelease,
  verifyAppRevocation
};
