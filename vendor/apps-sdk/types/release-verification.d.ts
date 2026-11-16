import { type AppBundle, type AppManifest, type AppTrustKeys } from './contract.js';
export declare function decodeAppBase64(value: unknown, maximum: number): Uint8Array;
export declare function decodeAppText(bytes: Uint8Array): string;
export declare function appBundleDigest(files: Record<string, string>): string;
/** Full canonical base64 file map is the digest input, including the original
 * radius-app.json bytes. Directory metadata is not executable release content.
 * ASCII paths and canonical base64 ensure the same snapshot on every platform. */
export declare function validateAppBundleFiles(value: unknown): {
    files: Record<string, string>;
    manifest: AppManifest;
    digest: string;
};
export declare function freezeAppBundle(bundle: AppBundle): AppBundle;
/** Catalog envelope v1 (no URLs, embedded keys, executable hooks or unsigned
 * auxiliary fields):
 * {schemaVersion:1,keyId,signature:base64(64 bytes),payload:{appId,version,
 *   apiVersion:'radius.apps/1',publisherId,digest:lowercase SHA256 hex,files}}
 * Ed25519 signs UTF-8 canonicalAppJson(payload). Host-supplied keys alone map
 * keyId to {publisherId,publicKeyPem}; the key must be Ed25519 and match the
 * payload publisher. Claimed appId/version/API must match the packaged manifest.
 * This verifies provenance, never installation permission or current revocation. */
export declare function verifyAppCatalogRelease(envelope: unknown, keys: AppTrustKeys): AppBundle;
