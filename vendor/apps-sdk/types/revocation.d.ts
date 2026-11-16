import { type AppTrustKeys } from './contract.js';
export interface AppReleaseRevocation {
    publisherId: string;
    appId: string;
    digest: string;
    revokedAt: string;
    reason: string;
}
export interface AppRevocationEnvelope {
    schemaVersion: 1;
    keyId: string;
    signature: string;
    payload: AppReleaseRevocation;
}
/** Domain-separated from release signatures. Server parsing is not trust. */
export declare function appRevocationSigningMessage(payload: AppReleaseRevocation): Uint8Array;
export declare function parseAppRevocation(value: unknown): AppRevocationEnvelope;
export declare function verifyAppRevocation(value: unknown, keys: AppTrustKeys): AppReleaseRevocation;
