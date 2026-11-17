import type { AppAction, AppArtifact, AppGenerationBudget, AppInstance, AppManifest, AppTriggerBinding, JsonObject, JsonValue } from './types/contract.js';
/** Public run status only: no input, configuration, context, result or exception text. */
export interface AppRunMetadata {
    id: string;
    installationId: string;
    instanceId?: string;
    action: string;
    status: 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
    createdAt: string;
    deadline: string;
    finishedAt?: string;
    /** Host-owned admission ceiling for agent runs, not measured usage; absent on older receipts and workers. */
    usageBudget?: Readonly<AppGenerationBudget>;
    error?: {
        code: string;
    };
    effects: {
        method: string;
        status: 'committed' | 'failed' | 'unknown';
        at: string;
    }[];
}
export interface AppRunReceipt extends AppRunMetadata {
    result?: JsonValue;
}
export type AppInstanceMetadata = Omit<AppInstance, 'state'>;
export type AppArtifactMetadata = Omit<AppArtifact, 'html'>;
export type AppTriggerBindingMetadata = Readonly<AppTriggerBinding>;
export interface AppGenerationDescription {
    profile: 'restricted-generation';
    available: boolean;
    usageBudget: Readonly<AppGenerationBudget>;
    unavailable: string | null;
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
    /** Additive host capability disclosure; older Radius versions omit it. */
    generation?: AppGenerationDescription;
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
/** Optional extension on older bridges. All owners come from the host, never method arguments. */
export interface RadiusAppViewLifecycle {
    /** Bound instance metadata (including configuration), or null for an unbound/stateless view. No state payload. */
    getInstance(): Promise<AppInstanceMetadata | null>;
    listRuns(): Promise<AppRunMetadata[]>;
    cancelRun(runId: string): Promise<AppRunMetadata>;
    /** Requires an existing artifacts.read grant. No artifact HTML or storage paths. */
    listArtifacts(): Promise<AppArtifactMetadata[]>;
    /** Requires an existing artifacts.open grant; cross-instance IDs are rejected by the host. */
    openArtifact(artifactId: string): Promise<JsonValue>;
    /** Read-only snapshots of owned bindings; no scheduling or configuration authority. */
    listTriggers(): Promise<AppTriggerBindingMetadata[]>;
}
/** Host-injected, document-bound API. It cannot install, grant or pick another owner.
 * The four original methods remain required; feature-check lifecycle methods on older Radius versions. */
export interface RadiusAppView extends Partial<RadiusAppViewLifecycle> {
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
