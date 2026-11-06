/**
 * The text of the pi extension, as it lands on disk. Split from the install
 * behaviour in `pi-plugin.ts` so ownership and payload stay separable; see
 * ADR-188 for why the file exists at all and when it is deleted.
 */

/**
 * First line of the extension. Ownership is this marker and nothing else: a
 * file at our path that does not carry it belongs to somebody else and is
 * never overwritten or removed.
 */
export const PI_EXTENSION_MARKER = "// langwatch:pi-telemetry-extension";

/** The command the extension runs for the session context record. */
export const PI_HOOK_COMMAND = "langwatch ingest hook pi";

/**
 * Instrumentation scope of every span the extension emits. Ours, not pi's: pi
 * declares span names and attribute keys, never a scope.
 */
export const PI_EXTENSION_SCOPE_NAME = "langwatch.pi-extension";

const PI_EXTENSION_PREAMBLE = `// Exports pi's own declared span tree to LangWatch and reports each session's
// repository, by running the CLI's session context hook. Managed by
// \`langwatch ingest install pi_cli\`; delete this file to opt out, or run
// \`langwatch logout\` to remove it along with the rest of the wiring.
import { spawn } from "node:child_process";

const HOOK_COMMAND = ${JSON.stringify(PI_HOOK_COMMAND.split(" "))};
const SCOPE_NAME = ${JSON.stringify(PI_EXTENSION_SCOPE_NAME)};
const FLUSH_TIMEOUT_MS = 5000;

// Every value below is a stand-in for a measurement pi's event surface does
// not carry, kept only because pi's schema marks the key required. ADR-188
// Decision 5 records each one; LangWatch reads none of them as a fact, and
// deleting this file is what retires them.
const LANE_NAME = "main";
const OPERATION_RECOVERY = false;
const TOOL_REPLAY = "never";
const TOOL_RECOVERY = false;
const AI_OPERATION = "stream";
const AI_STREAMING = true;
const STEP_ATTEMPT = 1;

// The standard GenAI switch for message content, read as the OTel
// instrumentations read it. Off unless set: prompts, replies and tool
// arguments are the user's own content.
const CONTENT_CAPTURE_SWITCH = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT";
const CONTENT_CAPTURE_VALUES = ["true", "span_only", "span_and_event"];
// The packages pi's loader resolves for every extension, under both of pi's names.
const PI_PACKAGES = ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"];
`;

const PI_EXTENSION_ENCODER = `
// Hand-built OTLP/HTTP protobuf. pi loads extensions through jiti with a
// virtual-module allowlist holding no @opentelemetry/* entry, and the
// extensions directory has no node_modules, so the OTel JS SDK cannot be
// reached from here. ADR-188 Decision 5.
const textEncoder = new TextEncoder();
const utf8 = (value) => textEncoder.encode(value);

const concat = (parts) => {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const varint = (value) => {
  const bytes = [];
  let rest = BigInt(value);
  while (rest > 127n) {
    bytes.push(Number(rest & 127n) | 128);
    rest >>= 7n;
  }
  bytes.push(Number(rest));
  return new Uint8Array(bytes);
};

const tag = (field, wire) => varint(field * 8 + wire);
const bytesField = (field, value) => concat([tag(field, 2), varint(value.length), value]);
const stringField = (field, value) => bytesField(field, utf8(value));
const varintField = (field, value) => concat([tag(field, 0), varint(value)]);

const fixed64Field = (field, value) => {
  const buffer = new Uint8Array(8);
  let rest = BigInt(value);
  for (let index = 0; index < 8; index += 1) {
    buffer[index] = Number(rest & 255n);
    rest >>= 8n;
  }
  return concat([tag(field, 1), buffer]);
};

const doubleField = (field, value) => {
  const buffer = new Uint8Array(8);
  new DataView(buffer.buffer).setFloat64(0, value, true);
  return concat([tag(field, 1), buffer]);
};

const anyValue = (value) => {
  if (typeof value === "boolean") return varintField(2, value ? 1 : 0);
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? varintField(3, value) : doubleField(4, value);
  }
  return stringField(1, String(value));
};

const attribute = (field, key, value) =>
  bytesField(field, concat([stringField(1, key), bytesField(2, anyValue(value))]));

const attributeList = (field, record) =>
  Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => attribute(field, key, value));

const encodeSpan = (span) =>
  concat([
    bytesField(1, span.traceId),
    bytesField(2, span.spanId),
    ...(span.parentSpanId ? [bytesField(4, span.parentSpanId)] : []),
    stringField(5, span.name),
    varintField(6, 1),
    fixed64Field(7, span.startNano),
    fixed64Field(8, span.endNano),
    ...attributeList(9, span.attributes),
    ...(span.isError ? [bytesField(15, varintField(3, 2))] : []),
  ]);

const encodeTraces = (spans, resource) =>
  bytesField(
    1,
    concat([
      bytesField(1, concat(attributeList(1, resource))),
      bytesField(
        2,
        concat([
          bytesField(1, stringField(1, SCOPE_NAME)),
          ...spans.map((span) => bytesField(2, encodeSpan(span))),
        ]),
      ),
    ]),
  );
`;

const PI_EXTENSION_EXPORTER = `
const spanQueue = [];
let traceIdBytes = null;

const randomBytes = (size) => {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

const traceId = () => {
  if (traceIdBytes === null) traceIdBytes = randomBytes(16);
  return traceIdBytes;
};

const spanId = () => randomBytes(8);
const nowNano = () => BigInt(Date.now()) * 1000000n;
const envValue = (name) => (process.env[name] ?? "").trim();

// The standard OTLP exporter timeout names, traces first, in milliseconds.
const flushTimeoutMs = () => {
  for (const name of ["OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "OTEL_EXPORTER_OTLP_TIMEOUT"]) {
    const parsed = Number.parseInt(envValue(name), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return FLUSH_TIMEOUT_MS;
};

const parseKeyValues = (raw) => {
  const out = {};
  for (const part of raw.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    out[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return out;
};

const trimTrailingSlashes = (value) => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

const tracesEndpoint = () => {
  const explicit = envValue("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  if (explicit !== "") return explicit;
  const base = envValue("OTEL_EXPORTER_OTLP_ENDPOINT");
  return base === "" ? "" : trimTrailingSlashes(base) + "/v1/traces";
};

const exportDisabled = () =>
  envValue("OTEL_TRACES_EXPORTER") === "none" || tracesEndpoint() === "";

let piVersion = null;

// pi's own version, from the package its loader hands every extension. A pi
// that resolves neither name leaves the resource without one.
const loadPiVersion = async () => {
  for (const specifier of PI_PACKAGES) {
    try {
      const module = await import(specifier);
      if (typeof module?.VERSION === "string" && module.VERSION !== "") return module.VERSION;
    } catch {
      // Not resolvable here; the next name may be.
    }
  }
  return null;
};

const captureContent = () =>
  CONTENT_CAPTURE_VALUES.includes(envValue(CONTENT_CAPTURE_SWITCH).toLowerCase());

const resourceAttributes = () => {
  const parsed = parseKeyValues(envValue("OTEL_RESOURCE_ATTRIBUTES"));
  if (!parsed["service.name"]) parsed["service.name"] = "pi";
  if (!parsed["service.version"] && piVersion !== null) parsed["service.version"] = piVersion;
  return parsed;
};

const record = (span) => {
  if (exportDisabled()) return;
  spanQueue.push(span);
};

// Bounded by its own timeout and swallowing every failure: an endpoint that
// does not answer must never hold pi's exit open. ADR-188 Decision 9.
const flush = async () => {
  if (spanQueue.length === 0) return;
  const batch = spanQueue.splice(0, spanQueue.length);
  const endpoint = tracesEndpoint();
  if (endpoint === "") return;
  const headers = parseKeyValues(envValue("OTEL_EXPORTER_OTLP_HEADERS"));
  headers["content-type"] = "application/x-protobuf";
  try {
    await fetch(endpoint, {
      method: "POST",
      headers,
      body: encodeTraces(batch, resourceAttributes()),
      signal: AbortSignal.timeout(flushTimeoutMs()),
    });
  } catch {
    // Nothing a pi run should ever hear about.
  }
};
`;

const PI_EXTENSION_HANDLERS = `
const STOP_REASONS = {
  stop: "stop",
  length: "length",
  toolUse: "tool_use",
  error: "error",
  aborted: "aborted",
  deferred: "deferred",
};

let sessionId = "";
let operationId = "";
let operationCount = 0;
let run = null;
let turn = null;
let compaction = null;
let navigation = null;
let requestStartNano = null;
let responseStatus = null;
let pendingPrompt = null;
const toolSpans = new Map();

// Derived, not guessed: pi's own session id plus a per-run counter is stable
// for the operation's whole life and unique across runs in one process.
const nextOperationId = (kind) => {
  operationCount += 1;
  return sessionId + "/" + kind + "/" + operationCount;
};

const operationAttributes = (kind, id) => ({
  "pi.session.id": sessionId,
  "pi.lane.name": LANE_NAME,
  "pi.operation.id": id,
  "pi.operation.recovery": OPERATION_RECOVERY,
  "pi.operation.kind": kind,
});

const sessionIdFrom = (ctx) => {
  const id = ctx?.sessionManager?.getSessionId?.();
  return typeof id === "string" ? id : "";
};

// The session's own directory first, so a worktree the session moved into is kept.
const cwdFrom = (ctx) => {
  const cwd = ctx?.sessionManager?.getCwd?.();
  return typeof cwd === "string" && cwd !== "" ? cwd : ctx?.cwd;
};

// Takes pi's session id from the handler's context when it has one; false while
// neither it nor an earlier run has named a session.
const adoptSession = (ctx) => {
  const id = sessionIdFrom(ctx);
  if (id !== "") sessionId = id;
  return sessionId !== "";
};

const toJson = (value) => {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

// The server keeps 256 KiB of any one value (DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES). Cut here too, so
// one huge tool result cannot push a run's single POST past the body limit and lose the run.
const MAX_CONTENT_BYTES = 256 * 1024;
const truncationMarker = (total) => "…[langwatch: truncated, " + total + " bytes total]";
const cutTo = (bytes, keep) => new TextDecoder().decode(bytes.subarray(0, Math.max(0, keep)));
const capped = (value) => {
  if (typeof value !== "string") return value;
  const bytes = utf8(value);
  if (bytes.length <= MAX_CONTENT_BYTES) return value;
  const marker = truncationMarker(bytes.length);
  return cutTo(bytes, MAX_CONTENT_BYTES - utf8(marker).length) + marker;
};

// The longest string anywhere in a parsed JSON value, as its holder and key.
const longestString = (holder, key, best = null) => {
  const value = holder[key];
  if (typeof value === "string") {
    return best === null || value.length > best.holder[best.key].length ? { holder, key } : best;
  }
  if (value === null || typeof value !== "object") return best;
  let found = best;
  for (const child of Object.keys(value)) found = longestString(value, child, found);
  return found;
};

// JSON of a value, kept within the limit as JSON is measured, escaping included. The longest
// strings are cut first, so the shape survives: a write call still names its path.
const boundedJson = (value) => {
  let json = toJson(value);
  if (json === undefined) return undefined;
  const total = utf8(json).length;
  if (total <= MAX_CONTENT_BYTES) return json;
  const marker = truncationMarker(total);
  const root = { value: JSON.parse(json) };
  for (let attempt = 0; attempt < 64; attempt++) {
    const over = utf8(json).length - MAX_CONTENT_BYTES;
    if (over <= 0) return json;
    const leaf = longestString(root, "value");
    if (leaf === null) return undefined;
    const current = leaf.holder[leaf.key];
    const bytes = utf8(current.endsWith(marker) ? current.slice(0, -marker.length) : current);
    leaf.holder[leaf.key] = cutTo(bytes, bytes.length - over - utf8(marker).length) + marker;
    json = JSON.stringify(root.value);
  }
  return utf8(json).length <= MAX_CONTENT_BYTES ? json : undefined;
};

// GenAI semantic-convention message parts: text, and a requested tool call.
const assistantParts = (message, withToolCalls) => {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.flatMap((part) => {
    if (part?.type === "text" && typeof part.text === "string" && part.text !== "") {
      return [{ type: "text", content: part.text }];
    }
    if (withToolCalls && part?.type === "toolCall") {
      return [{ type: "tool_call", id: part.id, name: part.name, arguments: part.arguments }];
    }
    return [];
  });
};

const outputMessages = (message, withToolCalls) => {
  const parts = assistantParts(message, withToolCalls);
  if (parts.length === 0) return undefined;
  const finishReason = STOP_REASONS[message?.stopReason];
  return boundedJson([
    { role: "assistant", parts, ...(finishReason ? { finish_reason: finishReason } : {}) },
  ]);
};

const inputMessages = (prompt) =>
  typeof prompt === "string" && prompt !== ""
    ? boundedJson([{ role: "user", parts: [{ type: "text", content: prompt }] }])
    : undefined;

// What the model read back from the tool: its text parts, as pi returned them.
const toolResultText = (result) => {
  if (typeof result === "string") return result === "" ? undefined : capped(result);
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\\n");
  return text === "" ? undefined : capped(text);
};

// The name the user gave the session in pi (/name), so the row carries it.
const sessionNameFrom = (ctx) => {
  const name = ctx?.sessionManager?.getSessionName?.();
  return typeof name === "string" && name.trim() !== "" ? name : undefined;
};

const runHook = (cwd, hookEvent, sessionName) => {
  if (sessionId === "") return;
  const payload = JSON.stringify({
    session_id: sessionId,
    cwd,
    hook_event_name: hookEvent,
    ...(sessionName !== undefined ? { session_title: sessionName } : {}),
  });
  try {
    const child = spawn(HOOK_COMMAND[0], HOOK_COMMAND.slice(1), {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(payload);
    child.unref();
  } catch {
    // Nothing a pi run should ever hear about.
  }
};

const lastAssistant = (event) => {
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  return messages.filter((message) => message?.role === "assistant").pop();
};

const runOutcome = (last, ctx) => {
  if (last?.stopReason === "aborted" || ctx?.signal?.aborted === true) return "aborted";
  if (last?.stopReason === "error") return "failed";
  return "completed";
};

const aiAttributes = (message, ctx) => {
  const usage = message?.usage ?? {};
  const cost = usage.cost ?? {};
  const model = message?.model ?? ctx?.model?.id;
  const provider = message?.provider ?? ctx?.model?.provider;
  return {
    "pi.session.id": sessionId,
    "pi.ai.operation": AI_OPERATION,
    "pi.ai.provider": provider,
    "pi.ai.model": model,
    "pi.ai.api": message?.api ?? ctx?.model?.api,
    "pi.ai.streaming": AI_STREAMING,
    "pi.ai.response.model": message?.responseModel,
    "pi.ai.response.id": message?.responseId,
    "pi.ai.response.stop_reason": STOP_REASONS[message?.stopReason],
    "pi.ai.http.status_code": responseStatus,
    "pi.ai.usage.input_tokens": usage.input,
    "pi.ai.usage.output_tokens": usage.output,
    "pi.ai.usage.cache_read_tokens": usage.cacheRead,
    "pi.ai.usage.cache_write_tokens": usage.cacheWrite,
    "pi.ai.usage.reasoning_tokens": usage.reasoning,
    "pi.ai.usage.total_tokens": usage.totalTokens,
    "pi.ai.usage.cost": cost.total,
    "gen_ai.operation.name": "chat",
    "gen_ai.system": provider,
    "gen_ai.request.model": model,
    "gen_ai.response.model": message?.responseModel,
    "gen_ai.usage.input_tokens": usage.input,
    "gen_ai.usage.output_tokens": usage.output,
    "gen_ai.output.messages": captureContent() ? outputMessages(message, true) : undefined,
  };
};

export default async (pi) => {
  // The prompt the user submitted, held for the run it opens.
  pi.on("before_agent_start", (event) => {
    pendingPrompt = typeof event?.prompt === "string" ? event.prompt : null;
  });

  // A pi build without the session manager gets no run, so nothing under it
  // is recorded: a span without pi's session id joins no session.
  pi.on("agent_start", (_event, ctx) => {
    const id = sessionIdFrom(ctx);
    const prompt = pendingPrompt;
    pendingPrompt = null;
    if (id === "") {
      run = null;
      return;
    }
    sessionId = id;
    operationId = nextOperationId("run");
    run = { spanId: spanId(), startNano: nowNano(), prompt };
    // The name is the user's own words: it leaves the machine only with content.
    runHook(cwdFrom(ctx), "SessionStart", captureContent() ? sessionNameFrom(ctx) : undefined);
  });

  pi.on("turn_start", (event) => {
    if (run === null) return;
    turn = {
      spanId: spanId(),
      startNano: nowNano(),
      turnId: String(event?.turnIndex ?? 0),
    };
  });

  pi.on("turn_end", () => {
    if (turn === null) return;
    record({
      traceId: traceId(),
      spanId: turn.spanId,
      parentSpanId: run?.spanId,
      name: "pi.harness.turn",
      startNano: turn.startNano,
      endNano: nowNano(),
      attributes: {
        "pi.session.id": sessionId,
        "pi.lane.name": LANE_NAME,
        "pi.operation.id": operationId,
        "pi.turn.id": turn.turnId,
      },
    });
    turn = null;
  });

  pi.on("tool_execution_start", (event) => {
    if (run === null || typeof event?.toolCallId !== "string") return;
    toolSpans.set(event.toolCallId, {
      spanId: spanId(),
      startNano: nowNano(),
      toolName: event.toolName,
      args: event.args,
      turnId: turn?.turnId,
      parentSpanId: turn?.spanId ?? run?.spanId,
    });
  });

  pi.on("tool_execution_end", (event) => {
    const pending = toolSpans.get(event?.toolCallId);
    if (pending === undefined) return;
    toolSpans.delete(event.toolCallId);
    const isError = event?.isError === true;
    const content = captureContent();
    record({
      traceId: traceId(),
      spanId: pending.spanId,
      parentSpanId: pending.parentSpanId,
      name: "pi.harness.tool",
      startNano: pending.startNano,
      endNano: nowNano(),
      isError,
      attributes: {
        "pi.session.id": sessionId,
        "pi.lane.name": LANE_NAME,
        "pi.operation.id": operationId,
        "pi.turn.id": pending.turnId,
        "pi.tool.name": event?.toolName ?? pending.toolName,
        "pi.tool.call_id": event.toolCallId,
        "pi.tool.replay": TOOL_REPLAY,
        "pi.tool.recovery": TOOL_RECOVERY,
        "pi.tool.is_error": isError,
        "gen_ai.tool.call.arguments": content ? boundedJson(pending.args) : undefined,
        "gen_ai.tool.call.result": content ? toolResultText(event?.result) : undefined,
      },
    });
  });

  pi.on("before_provider_request", () => {
    requestStartNano = nowNano();
    responseStatus = null;
  });

  pi.on("after_provider_response", (event) => {
    responseStatus = typeof event?.status === "number" ? event.status : null;
  });

  pi.on("message_end", (event, ctx) => {
    const message = event?.message;
    if (run === null || message?.role !== "assistant") return;
    const endNano = nowNano();
    record({
      traceId: traceId(),
      spanId: spanId(),
      parentSpanId: turn?.spanId ?? run?.spanId,
      name: "pi.ai.request",
      startNano: requestStartNano ?? endNano,
      endNano,
      isError: message.stopReason === "error",
      attributes: aiAttributes(message, ctx),
    });
    requestStartNano = null;
  });

  pi.on("session_before_compact", (_event, ctx) => {
    if (!adoptSession(ctx)) return;
    compaction = { spanId: spanId(), startNano: nowNano(), operationId: nextOperationId("compaction") };
  });

  // pi declares pi.compaction.reason on pi.harness.step, not on
  // pi.harness.compaction, so the reason rides a compaction step under it.
  pi.on("session_compact", (event) => {
    if (compaction === null) return;
    const endNano = nowNano();
    record({
      traceId: traceId(),
      spanId: spanId(),
      parentSpanId: compaction.spanId,
      name: "pi.harness.step",
      startNano: compaction.startNano,
      endNano,
      attributes: {
        "pi.session.id": sessionId,
        "pi.lane.name": LANE_NAME,
        "pi.operation.id": compaction.operationId,
        "pi.step.kind": "compaction",
        "pi.step.attempt": STEP_ATTEMPT,
        "pi.compaction.reason": event?.reason,
        "pi.step.outcome": "succeeded",
      },
    });
    record({
      traceId: traceId(),
      spanId: compaction.spanId,
      name: "pi.harness.compaction",
      startNano: compaction.startNano,
      endNano,
      attributes: {
        ...operationAttributes("compaction", compaction.operationId),
        "pi.operation.outcome": "completed",
      },
    });
    compaction = null;
  });

  pi.on("session_before_tree", (_event, ctx) => {
    if (!adoptSession(ctx)) return;
    navigation = { spanId: spanId(), startNano: nowNano(), operationId: nextOperationId("navigation") };
  });

  pi.on("session_tree", () => {
    if (navigation === null) return;
    record({
      traceId: traceId(),
      spanId: navigation.spanId,
      name: "pi.harness.navigation",
      startNano: navigation.startNano,
      endNano: nowNano(),
      attributes: {
        ...operationAttributes("navigation", navigation.operationId),
        "pi.operation.outcome": "completed",
      },
    });
    navigation = null;
  });

  // The run's input is the prompt that opened it and its output the reply that
  // closed it, so the trace and its session read as the conversation they were.
  pi.on("agent_end", async (event, ctx) => {
    if (run === null) return;
    const last = lastAssistant(event);
    const outcome = runOutcome(last, ctx);
    const content = captureContent();
    record({
      traceId: traceId(),
      spanId: run.spanId,
      name: "pi.harness.run",
      startNano: run.startNano,
      endNano: nowNano(),
      isError: outcome === "failed",
      attributes: {
        ...operationAttributes("run", operationId),
        "pi.operation.outcome": outcome,
        "gen_ai.input.messages": content ? inputMessages(run.prompt) : undefined,
        "gen_ai.output.messages": content ? outputMessages(last, false) : undefined,
      },
    });
    run = null;
    await flush();
  });

  pi.on("agent_settled", async () => {
    await flush();
  });

  pi.on("session_shutdown", async () => {
    await flush();
  });

  // Last, after every handler is registered: pi awaits the factory, so the
  // version is known before the first span is exported.
  piVersion = await loadPiVersion();
};
`;

/** The extension module, exactly as it lands on disk. */
export function piExtensionSource(): string {
  return `${PI_EXTENSION_MARKER}
${PI_EXTENSION_PREAMBLE}${PI_EXTENSION_ENCODER}${PI_EXTENSION_EXPORTER}${PI_EXTENSION_HANDLERS}`;
}
