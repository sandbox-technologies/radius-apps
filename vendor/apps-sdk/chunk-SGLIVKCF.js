// Generated public Radius Apps SDK. See SOURCE.json; update upstream, not this file.

// radius/src/shared/apps/contract.ts
var APP_API_VERSION = "radius.apps/1";
var APP_SCHEMA_VERSION = 2;
var APP_CAPABILITIES = ["storage.instance", "tabs.read", "tabs.layout", "chat.draft", "activity.read", "agent.run", "artifacts.write", "artifacts.read", "artifacts.open", "events.subscribe"];
var AppContractError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AppContractError";
  }
  code;
};
var APP_LIMITS = Object.freeze({
  installations: 128,
  instances: 256,
  runs: 2048,
  queued: 32,
  concurrent: 2,
  deadlineMs: 12e4,
  inputBytes: 128 * 1024,
  outputBytes: 2 * 1024 * 1024,
  stateBytes: 2 * 1024 * 1024,
  artifacts: 1024,
  events: 512,
  subscriptions: 64,
  contextTtlMs: 6e4,
  idempotencyMs: 24 * 60 * 60 * 1e3,
  bundleFiles: 256,
  bundleBytes: 16 * 1024 * 1024,
  bundleFileBytes: 8 * 1024 * 1024,
  storeBytes: 64 * 1024 * 1024,
  maxHostCalls: 256
});

// radius/src/shared/apps/manifest.ts
var APP_JSON_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, depth: 32, nodes: 1e5 });
var APP_MANIFEST_LIMITS = Object.freeze({ bytes: 256 * 1024, contributions: 64, schemaNodes: 256, schemaDepth: 12, valueBytes: 2 * 1024 * 1024 });
var APP_HOST_EVENTS = ["instance.state.changed", "run.completed", "artifact.created"];
var poison = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
var encoder = new TextEncoder();
var has = (o, k) => Object.hasOwn(o, k);
function invalid(message) {
  throw new AppContractError("INVALID_ARGUMENT", message);
}
function limit(message) {
  throw new AppContractError("LIMIT_EXCEEDED", message);
}
function check(ok, message) {
  if (!ok) invalid(message);
}
function scalarString(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 55296 && c <= 56319) {
      const next = value.charCodeAt(++i);
      check(next >= 56320 && next <= 57343, "Unpaired Unicode surrogate");
    } else check(c < 56320 || c > 57343, "Unpaired Unicode surrogate");
  }
}
function parseAppJson(text) {
  check(typeof text === "string", "JSON must be text");
  if (text.length > APP_JSON_LIMITS.bytes || encoder.encode(text).length > APP_JSON_LIMITS.bytes) limit("JSON is too large");
  let i = 0;
  let nodes = 0;
  const ws = () => {
    while (i < text.length && " 	\n\r".includes(text[i])) i++;
  };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      const c = text.charCodeAt(i++);
      if (c === 34) {
        let value;
        try {
          value = JSON.parse(text.slice(start, i));
        } catch {
          return invalid("Invalid JSON string");
        }
        scalarString(value);
        return value;
      }
      if (c === 92) i++;
      else check(c >= 32, "Control character in JSON string");
    }
    return invalid("Unterminated JSON string");
  };
  const read = (depth) => {
    if (depth > APP_JSON_LIMITS.depth || ++nodes > APP_JSON_LIMITS.nodes) limit("JSON complexity exceeded");
    ws();
    const c = text[i];
    if (c === '"') return string();
    if (c === "{") {
      i++;
      ws();
      const result2 = {};
      if (text[i] === "}") {
        i++;
        return result2;
      }
      while (true) {
        check(text[i] === '"', "Expected JSON object key");
        const key = string();
        check(!poison.has(key), "Forbidden JSON object key");
        check(!Object.hasOwn(result2, key), `Duplicate JSON key: ${key}`);
        ws();
        check(text[i++] === ":", "Expected JSON colon");
        result2[key] = read(depth + 1);
        ws();
        if (text[i] === "}") {
          i++;
          return result2;
        }
        check(text[i++] === ",", "Expected JSON comma");
        ws();
      }
    }
    if (c === "[") {
      i++;
      ws();
      const result2 = [];
      if (text[i] === "]") {
        i++;
        return result2;
      }
      while (true) {
        result2.push(read(depth + 1));
        ws();
        if (text[i] === "]") {
          i++;
          return result2;
        }
        check(text[i++] === ",", "Expected JSON comma");
      }
    }
    for (const [token, value2] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, i)) {
        i += token.length;
        return value2;
      }
    }
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    number.lastIndex = i;
    const match = number.exec(text);
    check(match, "Expected JSON value");
    i = number.lastIndex;
    const value = Number(match[0]);
    check(Number.isFinite(value), "Nonfinite JSON number");
    return value;
  };
  const result = read(0);
  ws();
  check(i === text.length, "Trailing JSON data");
  return result;
}
function canonicalAppJson(value) {
  const chunks = [];
  const active = /* @__PURE__ */ new Set();
  let nodes = 0;
  let bytes = 0;
  const emit = (s) => {
    if (s.length > APP_JSON_LIMITS.bytes || (bytes += encoder.encode(s).length) > APP_JSON_LIMITS.bytes) limit("JSON is too large");
    chunks.push(s);
  };
  const visit = (v, depth) => {
    if (++nodes > APP_JSON_LIMITS.nodes || depth > APP_JSON_LIMITS.depth) limit("JSON complexity exceeded");
    if (v === null || typeof v === "boolean") {
      emit(String(v));
      return;
    }
    if (typeof v === "number") {
      check(Number.isFinite(v), "Nonfinite JSON number");
      emit(JSON.stringify(v));
      return;
    }
    if (typeof v === "string") {
      if (v.length > APP_JSON_LIMITS.bytes) limit("JSON string is too large");
      scalarString(v);
      emit(JSON.stringify(v));
      return;
    }
    check(typeof v === "object", "Expected JSON data");
    check(!active.has(v), "Cyclic JSON data");
    const array = Array.isArray(v);
    check(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype) || !array && Object.getPrototypeOf(v) === null, "Expected plain JSON data");
    const keys2 = Reflect.ownKeys(v);
    if (keys2.length > APP_JSON_LIMITS.nodes) limit("JSON object is too large");
    check(keys2.every((k) => typeof k === "string"), "Symbol JSON key");
    active.add(v);
    if (array) {
      check(keys2.length === v.length + 1, "Sparse array or extra array property");
      emit("[");
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        check(d && has(d, "value") && d.enumerable, "Sparse/accessor JSON array");
        if (i) emit(",");
        visit(d.value, depth + 1);
      }
      emit("]");
    } else {
      emit("{");
      let first = true;
      for (const key of keys2.sort()) {
        check(!poison.has(key), "Forbidden JSON object key");
        scalarString(key);
        const d = Object.getOwnPropertyDescriptor(v, key);
        check(d && has(d, "value") && d.enumerable, "Accessor/non-enumerable JSON property");
        if (!first) emit(",");
        first = false;
        emit(JSON.stringify(key));
        emit(":");
        visit(d.value, depth + 1);
      }
      emit("}");
    }
    active.delete(v);
  };
  visit(value, 0);
  return chunks.join("");
}
function obj(v, label) {
  check(v !== null && typeof v === "object" && !Array.isArray(v), `${label} must be an object`);
  return v;
}
function keys(o, allowed, required = []) {
  for (const k of Object.keys(o)) check(allowed.includes(k), `Unsupported field: ${k}`);
  for (const k of required) check(has(o, k), `Missing field: ${k}`);
}
function str(v, label, max = 256) {
  check(typeof v === "string" && v.length > 0 && v.length <= max, `Invalid ${label}`);
  for (let i = 0; i < v.length; i++) check(v.charCodeAt(i) >= 32 && v.charCodeAt(i) !== 127, `Invalid ${label}`);
  return v;
}
function integer(v, min, max, label) {
  check(typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max, `Invalid ${label}`);
  return v;
}
function list(v, allowed, max = 64, nonempty = false) {
  check(Array.isArray(v) && v.length <= max && (!nonempty || v.length > 0), "Invalid string list");
  const seen = /* @__PURE__ */ new Set();
  for (const x of v) {
    str(x, "list entry", 128);
    check(!seen.has(x) && (!allowed || allowed.includes(x)), "Duplicate/unsupported list entry");
    seen.add(x);
  }
  return v;
}
function boundedJson(value, bytes) {
  const text = canonicalAppJson(value);
  if (encoder.encode(text).length > bytes) limit("JSON value exceeds its byte limit");
  return parseAppJson(text);
}
function validateAppSchema(schema) {
  const clean = obj(boundedJson(schema, APP_MANIFEST_LIMITS.bytes), "schema");
  validateSchemaTree(clean);
}
function validateSchemaTree(root) {
  let nodes = 0;
  const walk = (s, depth) => {
    if (++nodes > APP_MANIFEST_LIMITS.schemaNodes || depth > APP_MANIFEST_LIMITS.schemaDepth) limit("Schema complexity exceeded");
    const common = ["type", "title", "description", "default", "enum", "const"];
    const typeKeys = {
      object: ["properties", "required", "additionalProperties"],
      array: ["items", "minItems", "maxItems"],
      string: ["minLength", "maxLength"],
      number: ["minimum", "maximum"],
      integer: ["minimum", "maximum"],
      boolean: [],
      null: []
    };
    check(typeof s.type === "string" && has(typeKeys, s.type), "Unsupported schema type");
    keys(s, [...common, ...typeKeys[s.type]], ["type"]);
    if (has(s, "title")) str(s.title, "schema title");
    if (has(s, "description")) str(s.description, "schema description", 4096);
    if (s.type === "object") {
      check(s.additionalProperties === false, "Object schemas must set additionalProperties:false");
      const properties = has(s, "properties") ? obj(s.properties, "properties") : {};
      check(Object.keys(properties).length <= 128, "Too many schema properties");
      for (const [name, child] of Object.entries(properties)) {
        str(name, "property name", 128);
        walk(obj(child, "property schema"), depth + 1);
      }
      if (has(s, "required")) for (const name of list(s.required, void 0, 128)) check(has(properties, name), "Required property lacks a schema");
    }
    if (s.type === "array") walk(obj(s.items, "items schema"), depth + 1);
    for (const [lo, hi, maximum] of [["minItems", "maxItems", 1e4], ["minLength", "maxLength", APP_MANIFEST_LIMITS.valueBytes]]) {
      if (has(s, lo)) integer(s[lo], 0, maximum, lo);
      if (has(s, hi)) integer(s[hi], 0, maximum, hi);
      if (has(s, lo) && has(s, hi)) check(s[lo] <= s[hi], "Reversed schema bounds");
    }
    for (const field of ["minimum", "maximum"]) if (has(s, field)) check(typeof s[field] === "number" && Number.isFinite(s[field]), "Invalid numeric bound");
    if (has(s, "minimum") && has(s, "maximum")) check(s.minimum <= s.maximum, "Reversed numeric bounds");
    if (has(s, "enum")) {
      check(Array.isArray(s.enum) && s.enum.length > 0 && s.enum.length <= 64, "Invalid enum");
      const spellings = s.enum.map(canonicalAppJson);
      check(new Set(spellings).size === spellings.length, "Duplicate enum value");
      for (const value of s.enum) validateValueTree(s, value, false);
    }
    if (has(s, "const")) validateValueTree(s, s.const, false);
    if (has(s, "const") && has(s, "enum")) check(s.enum.some((v) => canonicalAppJson(v) === canonicalAppJson(s.const)), "const is outside enum");
    if (has(s, "default")) validateValueTree(s, s.default);
  };
  walk(root, 0);
}
function validateValueTree(schema, value, literals = true) {
  if (literals && has(schema, "enum")) check(schema.enum.some((v) => canonicalAppJson(v) === canonicalAppJson(value)), "Value is outside enum");
  if (literals && has(schema, "const")) check(canonicalAppJson(schema.const) === canonicalAppJson(value), "Value differs from const");
  switch (schema.type) {
    case "object": {
      const o = obj(value, "value");
      const properties = schema.properties ?? {};
      for (const k of schema.required ?? []) check(has(o, k), `Missing required property: ${k}`);
      for (const [k, v] of Object.entries(o)) {
        check(has(properties, k), `Unknown value property: ${k}`);
        validateValueTree(properties[k], v);
      }
      break;
    }
    case "array":
      check(Array.isArray(value), "Expected array");
      check(value.length <= (schema.maxItems ?? 1e4) && value.length >= (schema.minItems ?? 0), "Array length outside schema");
      for (const v of value) validateValueTree(schema.items, v);
      break;
    case "string": {
      check(typeof value === "string", "Expected string");
      let length = 0;
      for (const _point of value) length++;
      check(length >= (schema.minLength ?? 0) && length <= (schema.maxLength ?? APP_MANIFEST_LIMITS.valueBytes), "String length outside schema");
      break;
    }
    case "number":
    case "integer":
      check(typeof value === "number" && Number.isFinite(value) && (schema.type !== "integer" || Number.isSafeInteger(value)), "Expected finite number/safe integer");
      if (has(schema, "minimum")) check(value >= schema.minimum, "Number below minimum");
      if (has(schema, "maximum")) check(value <= schema.maximum, "Number above maximum");
      break;
    case "boolean":
      check(typeof value === "boolean", "Expected boolean");
      break;
    case "null":
      check(value === null, "Expected null");
      break;
    default:
      invalid("Unsupported schema type");
  }
}
function validateAppValue(schema, value) {
  const cleanSchema = obj(boundedJson(schema, APP_MANIFEST_LIMITS.bytes), "schema");
  validateSchemaTree(cleanSchema);
  validateValueTree(cleanSchema, boundedJson(value, APP_MANIFEST_LIMITS.valueBytes));
}
function validateAppBundlePath(value) {
  const path = str(value, "bundle path", 240);
  check(!path.startsWith("/") && !path.includes("\\") && path.split("/").length <= 16, "Invalid bundle path");
  for (const segment of path.split("/")) {
    check(/^[A-Za-z0-9_.-]+$/.test(segment) && segment !== "." && segment !== ".." && !segment.endsWith(".") && !poison.has(segment), "Invalid bundle path segment");
    check(!/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment), "Reserved bundle filename");
  }
  return path;
}
function requirement(value) {
  const r = obj(value, "requirement");
  keys(r, ["capability", "scope"], ["capability", "scope"]);
  const s = obj(r.scope, "scope");
  const fixed = (key, expected) => {
    keys(s, [key], [key]);
    check(s[key] === expected, "Unsupported capability scope");
  };
  switch (r.capability) {
    case "storage.instance":
      fixed("instance", "self");
      break;
    case "tabs.layout":
    case "chat.draft":
      fixed("target", "invocation");
      break;
    case "tabs.read":
      keys(s, ["target", "fields"], ["target", "fields"]);
      check(s.target === "invocation", "Unsupported tab target");
      list(s.fields, ["title", "url"], 2, true);
      break;
    case "activity.read":
      keys(s, ["source", "fields", "days"], ["source", "fields", "days"]);
      check(s.source === "conversation-metadata", "Unsupported activity source");
      list(s.fields, ["title", "createdAt", "updatedAt"], 3, true);
      integer(s.days, 1, 31, "activity days");
      break;
    case "agent.run":
      fixed("profile", "restricted-generation");
      break;
    case "artifacts.read":
    case "artifacts.write":
    case "artifacts.open":
      fixed("owner", "self");
      break;
    case "events.subscribe":
      keys(s, ["target", "events"], ["target", "events"]);
      check(s.target === "self", "Unsupported event target");
      list(s.events, APP_HOST_EVENTS, APP_HOST_EVENTS.length, true);
      break;
    default:
      invalid("Unsupported capability");
  }
  return { capability: r.capability, scope: s };
}
var emptySchema = () => ({ type: "object", properties: {}, additionalProperties: false });
function map(value, label) {
  const result = obj(value, label);
  check(Object.keys(result).length <= APP_MANIFEST_LIMITS.contributions, `Too many ${label}`);
  for (const id of Object.keys(result)) check(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id), `Invalid ${label} identifier`);
  return result;
}
function entry(value, extension) {
  check(extension.test(validateAppBundlePath(value)), "Unsupported entry file type");
}
function schemaField(value, objectOnly = false) {
  const s = obj(value, "schema");
  validateSchemaTree(s);
  if (objectOnly) check(s.type === "object", "Expected object schema");
}
function parseAppManifest(value) {
  const m = obj(boundedJson(value, APP_MANIFEST_LIMITS.bytes), "manifest");
  keys(m, ["schemaVersion", "apiVersion", "id", "name", "version", "description", "icon", "worker", "instances", "configurationSchema", "requires", "provides"], ["schemaVersion", "apiVersion", "id", "name", "version", "instances", "provides"]);
  if (m.schemaVersion !== APP_SCHEMA_VERSION || m.apiVersion !== APP_API_VERSION) throw new AppContractError("INCOMPATIBLE_API", "Unsupported app schema/API");
  check(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(str(m.id, "app ID", 160)), "Invalid app ID");
  str(m.name, "name", 120);
  const version = str(m.version, "version", 128);
  check(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version), "Invalid semantic version");
  if (has(m, "description")) str(m.description, "description", 4096);
  if (has(m, "icon")) entry(m.icon, /\.(?:png|svg|jpg|jpeg|webp|ico)$/);
  if (has(m, "worker")) {
    const worker = obj(m.worker, "worker");
    keys(worker, ["entry"], ["entry"]);
    entry(worker.entry, /\.(?:js|mjs)$/);
  }
  const instances = obj(m.instances, "instances");
  keys(instances, ["mode", "stateSchemaVersion"], ["mode", "stateSchemaVersion"]);
  check(["none", "single", "multiple"].includes(instances.mode), "Unsupported instance mode");
  integer(instances.stateSchemaVersion, 1, 2147483647, "stateSchemaVersion");
  if (!has(m, "configurationSchema")) m.configurationSchema = emptySchema();
  schemaField(m.configurationSchema, true);
  if (!has(m, "requires")) m.requires = {};
  const requirements = map(m.requires, "requirements");
  for (const r of Object.values(requirements)) {
    const req = requirement(r);
    check(instances.mode !== "none" || req.capability !== "storage.instance", "Stateless apps cannot request instance storage");
  }
  const provides = obj(m.provides, "provides");
  keys(provides, ["actions", "views", "events", "triggers"]);
  for (const name of ["actions", "views", "events", "triggers"]) if (!has(provides, name)) provides[name] = {};
  const actions = map(provides.actions, "actions");
  const views = map(provides.views, "views");
  const events = map(provides.events, "events");
  const triggers = map(provides.triggers, "triggers");
  check(Object.keys(actions).length + Object.keys(views).length > 0, "App needs an action or view");
  for (const value2 of Object.values(actions)) {
    const a = obj(value2, "action");
    keys(a, ["title", "description", "contexts", "inputSchema", "outputSchema", "requires", "implementation"], ["title", "contexts", "inputSchema", "outputSchema", "requires", "implementation"]);
    str(a.title, "action title", 120);
    if (has(a, "description")) str(a.description, "action description", 4096);
    list(a.contexts, ["app", "tab"], 2, true);
    schemaField(a.inputSchema, true);
    schemaField(a.outputSchema);
    const refs = list(a.requires);
    for (const ref of refs) check(has(requirements, ref), "Unresolved action requirement");
    const impl = obj(a.implementation, "implementation");
    if (impl.kind === "handler") {
      keys(impl, ["kind", "export"], ["kind", "export"]);
      check(has(m, "worker"), "Handler requires worker.entry");
      check(/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(str(impl.export, "handler export", 128)) && !poison.has(impl.export), "Invalid handler export");
    } else {
      keys(impl, ["kind", "prompt", "profile", "context", "result"], ["kind", "prompt", "profile", "context", "result"]);
      check(impl.kind === "agent" && impl.profile === "restricted-generation" && impl.result === "html-artifact", "Unsupported implementation/profile/result");
      entry(impl.prompt, /\.(?:md|txt)$/);
      check(Array.isArray(impl.context) && impl.context.length <= 16, "Invalid agent context");
      const seen = /* @__PURE__ */ new Set();
      for (const value3 of impl.context) {
        const c = obj(value3, "agent context");
        keys(c, ["requirement", "selector"], ["requirement", "selector"]);
        const id = str(c.requirement, "context requirement", 64);
        check(refs.includes(id) && !seen.has(id) && requirements[id].capability === "activity.read" && c.selector === "previous-local-day", "Unsupported agent context selector/requirement");
        seen.add(id);
      }
      for (const cap of ["agent.run", "artifacts.write"]) check(refs.some((r) => requirements[r].capability === cap), `Agent result requires ${cap}`);
      const output = a.outputSchema;
      check(output.type === "object" && output.required?.length === 1 && output.required[0] === "artifactId" && obj(output.properties, "output properties").artifactId?.type === "string", "HTML artifact result requires only artifactId in its output schema");
    }
  }
  for (const value2 of Object.values(views)) {
    const v = obj(value2, "view");
    keys(v, ["title", "entry", "placement"], ["title", "entry", "placement"]);
    str(v.title, "view title", 120);
    entry(v.entry, /\.(?:html|htm)$/);
    check(v.placement === "tab", "Unsupported view placement");
  }
  for (const value2 of Object.values(events)) {
    const e = obj(value2, "event");
    keys(e, ["payloadSchema"], ["payloadSchema"]);
    schemaField(e.payloadSchema);
  }
  for (const value2 of Object.values(triggers)) {
    const t = obj(value2, "trigger");
    check(typeof t.action === "string" && has(actions, t.action), "Unresolved trigger action");
    const a = actions[t.action];
    obj(t.input, "trigger input");
    validateValueTree(a.inputSchema, t.input);
    if (t.kind === "schedule") {
      keys(t, ["kind", "action", "input", "suggested"], ["kind", "action", "input"]);
      if (has(t, "suggested")) {
        const s = obj(t.suggested, "suggested");
        keys(s, ["localTime"], ["localTime"]);
        check(typeof s.localTime === "string" && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(s.localTime), "Invalid daily localTime");
      }
    } else {
      keys(t, ["kind", "action", "input", "event", "filter"], ["kind", "action", "input", "event", "filter"]);
      check(t.kind === "event" && APP_HOST_EVENTS.includes(t.event), "Unsupported trigger event");
      keys(obj(t.filter, "event filter"), []);
      check(a.requires.some((id) => {
        const r = requirements[id];
        return r.capability === "events.subscribe" && r.scope.events.includes(t.event);
      }), "Event trigger requires a matching subscription scope");
    }
  }
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    apiVersion: APP_API_VERSION,
    id: m.id,
    name: m.name,
    version,
    ...has(m, "description") ? { description: m.description } : {},
    ...has(m, "icon") ? { icon: m.icon } : {},
    ...has(m, "worker") ? { worker: { entry: m.worker.entry } } : {},
    instances: { mode: instances.mode, stateSchemaVersion: instances.stateSchemaVersion },
    configurationSchema: m.configurationSchema,
    requires: requirements,
    provides: {
      actions,
      views,
      events,
      triggers
    }
  };
}

export {
  APP_API_VERSION,
  APP_SCHEMA_VERSION,
  APP_CAPABILITIES,
  AppContractError,
  APP_LIMITS,
  APP_JSON_LIMITS,
  APP_MANIFEST_LIMITS,
  APP_HOST_EVENTS,
  parseAppJson,
  canonicalAppJson,
  validateAppSchema,
  validateAppValue,
  validateAppBundlePath,
  parseAppManifest
};
