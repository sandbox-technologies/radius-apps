import { type AppManifest, type AppSchema, type JsonValue } from './contract.js';
/** API v1 limits, not author-controlled schema options. The JSON ceiling also fits
 * a complete 16 MiB base64 bundle envelope; manifests and runtime values are smaller. */
export declare const APP_JSON_LIMITS: Readonly<{
    bytes: number;
    depth: 32;
    nodes: 100000;
}>;
export declare const APP_MANIFEST_LIMITS: Readonly<{
    bytes: number;
    contributions: 64;
    schemaNodes: 256;
    schemaDepth: 12;
    valueBytes: number;
}>;
export declare const APP_HOST_EVENTS: readonly ["instance.state.changed", "run.completed", "artifact.created"];
/** Strict JSON, including escaped duplicate keys. No reviver (duplicates have
 * already been lost by then), prototype keys, BOM, comments, or nonfinite values. */
export declare function parseAppJson(text: string): JsonValue;
/** Radius canonical JSON v1: UTF-16 key ordering, JSON.stringify scalar spelling
 * (including -0 => 0), no whitespace. Not a claim to support another JCS dialect.
 * Only plain data objects/dense arrays are accepted; getters/toJSON never run. */
export declare function canonicalAppJson(value: unknown): string;
/** Closed schema dialect: exactly one type; object properties/required and
 * additionalProperties:false; homogeneous arrays (items); min/maxItems,
 * min/maxLength (Unicode code points), minimum/maximum; enum/const; descriptive
 * title/description and schema-valid default. No $ref, pattern, format, union,
 * coercion, mutation/default insertion, or silently ignored keywords. */
export declare function validateAppSchema(schema: AppSchema): void;
export declare function validateAppValue(schema: AppSchema, value: unknown): void;
/** Portable, URL-unambiguous package paths. ASCII-only prevents Unicode
 * normalization/casefold aliases across supported filesystems. */
export declare function validateAppBundlePath(value: unknown): string;
export declare function parseAppManifest(value: unknown): AppManifest;
