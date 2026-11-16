import { AppContractError, parseAppManifest, validateAppValue } from '@radius/apps-sdk';

// Schema assertions for trusted developer tests only. These do not execute an
// app, enforce permissions, emulate native effects, or provide a security sandbox.
function action(manifest, actionId) {
  const parsed = parseAppManifest(manifest);
  if (!Object.hasOwn(parsed.provides.actions, actionId)) {
    throw new AppContractError('NOT_FOUND', `Unknown app action: ${actionId}`);
  }
  return parsed.provides.actions[actionId];
}

export function validateActionInput(manifest, actionId, value) {
  validateAppValue(action(manifest, actionId).inputSchema, value);
}

export function validateActionOutput(manifest, actionId, value) {
  validateAppValue(action(manifest, actionId).outputSchema, value);
}

export function validateConfiguration(manifest, value) {
  validateAppValue(parseAppManifest(manifest).configurationSchema, value);
}
