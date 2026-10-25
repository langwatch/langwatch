// Code-block runner for JavaScript, run by QuickJS inside the engine's wasm
// runtime (ADR-183). The wire is runner.py's: one JSON payload line on stdin
// ({code, inputs, outputs, secrets, params}), the result JSON written to the
// path in scriptArgs[1]. User code is an ES module whose default export (or
// `execute` export) receives the inputs as one object and returns an object.

import * as os from "qjs:os";
import * as std from "qjs:std";

const FRAME = "\x1eLWHOST ";
const resultPath = scriptArgs[1];
const hostOut = std.out;
const hostIn = std.in;

// hostCall is one synchronous request to the engine; see bridge.go.
function hostCall(op, args) {
  hostOut.puts(FRAME + JSON.stringify({ op, ...args }) + "\n");
  hostOut.flush();
  const line = hostIn.getline();
  if (line === null) throw new Error("the engine closed the host bridge");
  return JSON.parse(line);
}

// Strings cross the bridge as base64 of their UTF-8 bytes.
const utf8ToBinary = (text) => unescape(encodeURIComponent(text));
function binaryToUtf8(binary) {
  try {
    return decodeURIComponent(escape(binary));
  } catch {
    return binary;
  }
}
function bytesToBinary(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return out;
}
function binaryToBytes(binary) {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

class Headers {
  #map = new Map();
  constructor(init) {
    if (init instanceof Headers) init = [...init];
    else if (init && !Array.isArray(init)) init = Object.entries(init);
    for (const [name, value] of init ?? []) this.append(name, value);
  }
  append(name, value) {
    const key = String(name).toLowerCase();
    const prev = this.#map.get(key);
    this.#map.set(key, prev === undefined ? String(value) : `${prev}, ${value}`);
  }
  set(name, value) {
    this.#map.set(String(name).toLowerCase(), String(value));
  }
  get(name) {
    return this.#map.get(String(name).toLowerCase()) ?? null;
  }
  has(name) {
    return this.#map.has(String(name).toLowerCase());
  }
  delete(name) {
    this.#map.delete(String(name).toLowerCase());
  }
  forEach(fn) {
    for (const [k, v] of this.#map) fn(v, k, this);
  }
  entries() {
    return this.#map.entries();
  }
  keys() {
    return this.#map.keys();
  }
  values() {
    return this.#map.values();
  }
  [Symbol.iterator]() {
    return this.#map.entries();
  }
}

class Response {
  #binary;
  constructor(reply) {
    this.status = reply.status;
    this.ok = reply.status >= 200 && reply.status < 300;
    this.statusText = "";
    this.url = reply.url ?? "";
    this.headers = new Headers(
      Object.entries(reply.headers ?? {}).map(([k, v]) => [k, v.join(", ")]),
    );
    this.#binary = atob(reply.body_b64 ?? "");
  }
  async text() {
    return binaryToUtf8(this.#binary);
  }
  async json() {
    return JSON.parse(binaryToUtf8(this.#binary));
  }
  async arrayBuffer() {
    return binaryToBytes(this.#binary).buffer;
  }
}

function bodyToBinary(body) {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return utf8ToBinary(body);
  if (body instanceof ArrayBuffer) return bytesToBinary(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    return bytesToBinary(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  throw new TypeError("fetch body must be a string, ArrayBuffer or typed array");
}

// fetch is the engine's request, held to the deployment's egress policy.
async function fetch(input, init = {}) {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  const reply = hostCall("fetch", {
    method: (init.method ?? "GET").toUpperCase(),
    url,
    headers: Object.fromEntries(new Headers(init.headers)),
    body_b64: btoa(bodyToBinary(init.body)),
  });
  if (!reply.ok) {
    const error = new TypeError(`fetch failed: ${reply.error}`);
    error.cause = { kind: reply.kind };
    throw error;
  }
  return new Response(reply);
}

function setTimeout(fn, ms = 0, ...args) {
  return os.setTimeout(() => fn(...args), ms);
}
function setInterval(fn, ms = 0, ...args) {
  const handle = { timer: null };
  const tick = () => {
    handle.timer = os.setTimeout(tick, ms);
    fn(...args);
  };
  handle.timer = os.setTimeout(tick, ms);
  return handle;
}
function clearTimeout(handle) {
  if (handle && typeof handle === "object" && "timer" in handle) {
    os.clearTimeout(handle.timer);
  } else if (handle !== undefined && handle !== null) {
    os.clearTimeout(handle);
  }
}

function describe(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ? `${value}\n${value.stack}` : String(value);
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// text reads a field the customer's error controls; a getter that throws or a
// name that is not a string must not stop the result from being written.
function text(read, fallback) {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function errorOf(e) {
  let isError = false;
  try {
    isError = e instanceof Error;
  } catch {
    // A Proxy whose prototype trap throws is described as a plain value.
  }
  if (!isError) return { type: "Error", message: text(() => describe(e), "Error"), traceback: "" };
  const type = text(() => e.name, "Error");
  const message = text(() => e.message, "");
  return { type, message, traceback: `${type}: ${message}\n${text(() => e.stack, "")}` };
}

const captured = { stdout: "", stderr: "" };
const writer =
  (stream) =>
  (...args) => {
    captured[stream] += args.map(describe).join(" ") + "\n";
  };
const console = {
  log: writer("stdout"),
  info: writer("stdout"),
  debug: writer("stdout"),
  warn: writer("stderr"),
  error: writer("stderr"),
};

// namespace is `secrets` / `params`: an unknown name throws, as in Python.
function namespace(kind, values) {
  const target = Object.freeze({ ...values });
  return new Proxy(target, {
    get(t, key) {
      if (typeof key !== "string" || key in t || key === "toJSON" || key === "then") {
        return Reflect.get(t, key);
      }
      throw new ReferenceError(`${kind} "${key}" is not configured`);
    },
  });
}

function isClass(value) {
  return typeof value === "function" && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

async function invoke(module, inputs) {
  const entry = module.default ?? module.execute;
  if (isClass(entry)) {
    const instance = new entry();
    if (typeof instance.execute !== "function") {
      throw new TypeError("the exported class must define execute(inputs)");
    }
    return instance.execute(inputs);
  }
  if (typeof entry === "function") return entry(inputs);
  throw new TypeError(
    "code must export a function: `export default function (inputs) { return { output } }`",
  );
}

function coerce(result) {
  if (result === undefined || result === null) return {};
  if (typeof result === "object" && !Array.isArray(result)) return { ...result };
  throw new TypeError(
    `the code block must return an object, got ${Array.isArray(result) ? "array" : typeof result}`,
  );
}

function writeResult(fields) {
  const result = {
    outputs: fields.outputs ?? {},
    stdout: captured.stdout,
    stderr: captured.stderr,
    duration_ms: fields.duration_ms ?? 0,
    error: fields.error ?? null,
  };
  let text;
  try {
    text = JSON.stringify(result);
  } catch (e) {
    result.outputs = {};
    result.error = {
      type: "TypeError",
      message: `outputs are not JSON: ${e.message}`,
      traceback: "",
    };
    text = JSON.stringify(result);
  }
  const file = std.open(resultPath, "w");
  file.puts(text);
  file.close();
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(hostIn.getline() ?? "");
  } catch (e) {
    writeResult({
      error: {
        type: "ProtocolError",
        message: `invalid JSON on stdin: ${e.message}`,
        traceback: "",
      },
    });
    return;
  }
  Object.assign(globalThis, {
    console,
    fetch,
    Headers,
    Response,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval: clearTimeout,
  });
  if (payload.secrets && Object.keys(payload.secrets).length) {
    globalThis.secrets = namespace("secret", payload.secrets);
  }
  if (payload.params && Object.keys(payload.params).length) {
    globalThis.params = namespace("param", payload.params);
  }

  const started = Date.now();
  let outputs = {};
  let error = null;
  try {
    const codePath = resultPath.replace(/[^/]*$/, "code-block.mjs");
    const file = std.open(codePath, "w");
    file.puts(payload.code ?? "");
    file.close();
    const module = await import(codePath);
    const result = coerce(await invoke(module, payload.inputs ?? {}));
    for (const name of payload.outputs ?? []) {
      if (!(name in result)) throw new ReferenceError(`missing_output: ${name}`);
    }
    outputs = result;
  } catch (e) {
    error = errorOf(e);
  }
  writeResult({ outputs, error, duration_ms: Date.now() - started });
}

await main();
