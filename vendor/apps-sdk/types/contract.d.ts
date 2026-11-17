/** Radius Apps v2. Transport adapters, never request JSON, establish principals. */
export declare const APP_API_VERSION: "radius.apps/1";
export declare const APP_SCHEMA_VERSION: 2;
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
export type AppSchema = Record<string, unknown>;
export declare const APP_CAPABILITIES: readonly ["storage.instance", "tabs.read", "tabs.layout", "chat.draft", "activity.read", "agent.run", "artifacts.write", "artifacts.read", "artifacts.open", "events.subscribe"];
export type AppCapability = typeof APP_CAPABILITIES[number];
/** Host-owned pre-spend ceilings, not caller options or measured usage. A host
 * must keep generation unavailable unless its selected harness enforces both. */
export declare const APP_GENERATION_LIMITS: Readonly<{
    maxTotalTokens: 8192;
    maxCostUsd: 1;
}>;
export interface AppGenerationBudget {
    maxTotalTokens: number;
    maxCostUsd: number;
}
export interface AppRequirement {
    capability: AppCapability;
    scope: JsonObject;
}
export type AppImplementation = {
    kind: 'handler';
    export: string;
} | {
    kind: 'agent';
    prompt: string;
    profile: 'restricted-generation';
    context: {
        requirement: string;
        selector: 'previous-local-day';
    }[];
    result: 'html-artifact';
};
export interface AppAction {
    title: string;
    description?: string;
    contexts: ('app' | 'tab')[];
    inputSchema: AppSchema;
    outputSchema: AppSchema;
    requires: string[];
    implementation: AppImplementation;
}
export interface AppView {
    title: string;
    entry: string;
    placement: 'tab';
}
export type AppTrigger = {
    kind: 'schedule';
    action: string;
    input: JsonObject;
    suggested?: {
        localTime: string;
    };
} | {
    kind: 'event';
    action: string;
    input: JsonObject;
    event: string;
    filter: JsonObject;
};
export interface AppManifest {
    schemaVersion: 2;
    apiVersion: typeof APP_API_VERSION;
    id: string;
    name: string;
    version: string;
    description?: string;
    icon?: string;
    worker?: {
        entry: string;
    };
    instances: {
        mode: 'none' | 'single' | 'multiple';
        stateSchemaVersion: number;
    };
    configurationSchema: AppSchema;
    requires: Record<string, AppRequirement>;
    provides: {
        actions: Record<string, AppAction>;
        views: Record<string, AppView>;
        events: Record<string, {
            payloadSchema: AppSchema;
        }>;
        triggers: Record<string, AppTrigger>;
    };
}
export type AppProvenance = {
    kind: 'local';
} | {
    kind: 'catalog';
    publisherId: string;
    keyId: string;
};
export interface AppBundle {
    digest: string;
    manifest: AppManifest;
    files: Record<string, string>;
    source: AppProvenance;
}
export interface AppTrustKey {
    publisherId: string;
    publicKeyPem: string;
}
export type AppTrustKeys = Record<string, AppTrustKey>;
export interface AppPrincipal {
    kind: 'user' | 'agent' | 'view' | 'trigger';
    id: string;
    installationId?: string;
    instanceId?: string;
    epoch?: number;
    releaseDigest?: string;
}
export interface AppInstallation {
    id: string;
    appId: string;
    releaseDigest: string;
    enabled: boolean;
    grants: string[];
    epoch: number;
    allowAgentInvocation: boolean;
    removed?: boolean;
    createdAt: string;
}
export interface AppInstance {
    id: string;
    installationId: string;
    configuration: JsonObject;
    configurationRevision: number;
    stateSchemaVersion: number;
    state: JsonValue;
    revision: number;
    createdAt: string;
}
export interface AppCapturedContext {
    tabId: string;
    windowId: string;
    documentId: string;
    title: string;
    url: string;
}
export interface AppInvocation {
    installationId: string;
    instanceId?: string;
    action: string;
    input: JsonObject;
    contextHandle?: string;
    idempotencyKey: string;
}
export interface AppEffect {
    method: string;
    status: 'committed' | 'failed' | 'unknown';
    at: string;
    detail?: string;
}
export type AppRunStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface AppRun {
    id: string;
    installationId: string;
    instanceId?: string;
    action: string;
    input: JsonObject;
    callerId: string;
    callerKind: AppPrincipal['kind'];
    idempotencyKey: string;
    fingerprint: string;
    releaseDigest: string;
    epoch: number;
    configuration: JsonObject;
    configurationRevision: number;
    context?: AppCapturedContext;
    status: AppRunStatus;
    createdAt: string;
    deadline: string;
    finishedAt?: string;
    logicalTime: string;
    /** Admission snapshot for agent actions; absent on older receipts and workers. */
    usageBudget?: AppGenerationBudget;
    trigger?: {
        bindingId: string;
        revision: number;
        occurrence: string;
        delivery: 'none' | 'background-tab';
    };
    eventRootRunId?: string;
    eventDepth?: number;
    result?: JsonValue;
    error?: {
        code: string;
        message: string;
    };
    effects: AppEffect[];
}
export interface AppArtifact {
    id: string;
    installationId: string;
    instanceId?: string;
    runId: string;
    releaseDigest: string;
    title: string;
    html: string;
    createdAt: string;
}
export interface AppTriggerBinding {
    id: string;
    installationId: string;
    instanceId?: string;
    trigger: string;
    enabled: boolean;
    revision: number;
    input: JsonObject;
    timeZone?: string;
    localTime?: string;
    effectiveDate?: string;
    delivery: 'none' | 'background-tab';
    /** Local dates already claimed, retained across edits and enable/disable. */
    occurrences: string[];
    /** Bounded event stream cursor; enables never replay historical events. */
    eventAfter?: number;
}
export interface AppEvent {
    id: string;
    sequence: number;
    installationId: string;
    epoch: number;
    instanceId?: string;
    runId?: string;
    rootRunId?: string;
    depth?: number;
    name: string;
    payload: JsonValue;
    at: string;
}
export interface AppWorkerInput {
    modules: Record<string, string>;
    entry: string;
    exportName: string;
    input: JsonObject;
    metadata: {
        runId: string;
        installationId: string;
        instanceId?: string;
        configuration: JsonObject;
        logicalTime: string;
    };
    deadlineMs: number;
    memoryLimitBytes?: number;
}
export interface AppWorkerExecutor {
    execute(input: AppWorkerInput, call: (method: string, input: JsonObject) => Promise<JsonValue>, signal: AbortSignal): Promise<JsonValue>;
}
export declare class AppContractError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare const APP_LIMITS: Readonly<{
    installations: 128;
    instances: 256;
    runs: 2048;
    queued: 32;
    concurrent: 2;
    deadlineMs: 120000;
    inputBytes: number;
    outputBytes: number;
    stateBytes: number;
    artifacts: 1024;
    events: 512;
    subscriptions: 64;
    contextTtlMs: 60000;
    idempotencyMs: number;
    bundleFiles: 256;
    bundleBytes: number;
    bundleFileBytes: number;
    storeBytes: number;
    maxHostCalls: 256;
}>;
