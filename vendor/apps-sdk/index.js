// Generated public Radius Apps SDK. See SOURCE.json; update upstream, not this file.
import {
  APP_API_VERSION,
  APP_CAPABILITIES,
  APP_GENERATION_LIMITS,
  APP_HOST_EVENTS,
  APP_JSON_LIMITS,
  APP_LIMITS,
  APP_MANIFEST_LIMITS,
  APP_SCHEMA_VERSION,
  AppContractError,
  canonicalAppJson,
  parseAppJson,
  parseAppManifest,
  validateAppBundlePath,
  validateAppSchema,
  validateAppValue
} from "./chunk-K6GAENIY.js";

// packages/radius-app-sdk/src/view.ts
function getRadiusApp() {
  const api = globalThis.radiusApp;
  if (!api || ["describe", "invoke", "getRun", "events"].some((key) => typeof api[key] !== "function")) {
    throw Object.assign(new Error("Open this installed app in Radius; no app bridge is available here"), { code: "CAPABILITY_UNAVAILABLE" });
  }
  return api;
}
export {
  APP_API_VERSION,
  APP_CAPABILITIES,
  APP_GENERATION_LIMITS,
  APP_HOST_EVENTS,
  APP_JSON_LIMITS,
  APP_LIMITS,
  APP_MANIFEST_LIMITS,
  APP_SCHEMA_VERSION,
  AppContractError,
  canonicalAppJson,
  getRadiusApp,
  parseAppJson,
  parseAppManifest,
  validateAppBundlePath,
  validateAppSchema,
  validateAppValue
};
