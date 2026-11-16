import type { AppAction, AppManifest, JsonObject, JsonValue } from './types/contract.js';
export interface AppRunReceipt {
    id: string;
    installationId: string;
    instanceId?: string;
    action: string;
    status: 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
    createdAt: string;
    deadline: string;
    finishedAt?: string;
    result?: JsonValue;
    error?: {
        code: string;
    };
    effects: {
        method: string;
        status: 'committed' | 'failed' | 'unknown';
        at: string;
    }[];
}
export interface AppDescription {
    apiVersion: 'radius.apps/1';
    installation: {
        id: string;
        appId: string;
        releaseDigest: string;
        enabled: boolean;
        grants: string[];
        epoch: number;
        allowAgentInvocation: boolean;
        createdAt: string;
    };
    manifest: AppManifest;
    limits: Readonly<Record<string, number>>;
    executionProfiles: string[];
    actions: Record<string, AppAction & {
        unavailable: string | null;
    }>;
}
export interface AppEventPage {
    events: {
        id: string;
        sequence: number;
        name: string;
        payload: JsonValue;
        at: string;
    }[];
    sequence: number;
    gap: boolean;
}
/** Host-injected, document-bound API. It cannot install, grant or pick another owner. */
export interface RadiusAppView {
    describe(): Promise<AppDescription>;
    invoke(action: string, input: JsonObject, options?: {
        contextHandle?: string;
    }): Promise<AppRunReceipt>;
    getRun(runId: string): Promise<AppRunReceipt>;
    events(after?: number): Promise<AppEventPage>;
}
export interface AppWorkerContext {
    readonly host: {
        call(method: string, input: JsonObject): Promise<JsonValue>;
    };
    readonly metadata: {
        readonly runId: string;
        readonly installationId: string;
        readonly instanceId?: string;
        readonly configuration: JsonObject;
        readonly logicalTime: string;
    };
    readonly run: AppWorkerContext['metadata'];
    readonly configuration: JsonObject;
    /** Read-only compatibility facade; the host enforces cancellation by terminating the guest. */
    readonly signal: {
        readonly aborted: boolean;
        readonly reason: unknown;
        throwIfAborted(): void;
    };
}
export type AppHandler = (input: JsonObject, context: AppWorkerContext) => Promise<JsonValue>;
/** An ergonomic accessor, NOT a trust check or fallback bridge. Importing never invokes an action. */
export declare function getRadiusApp(): RadiusAppView;
