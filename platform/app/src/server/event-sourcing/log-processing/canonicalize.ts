import { createHash } from "node:crypto";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { isValidSpanId, isValidTraceId } from "~/server/tracer/utils";
import type { DeepPartial } from "~/utils/types";
import type {
  CanonicalLogRecord,
  LogCorrelationSource,
  LogProviderKind,
  PIIRedactionLevel,
} from "./schema";

/**
 * OTLP log request -> canonical record (specs/otlp/canonical-log-ingestion.feature).
 *
 * A log record is content-addressed: `recordId` is a hash of everything in
 * `canonicalPayload`, so the same wire record produces the same id no matter
 * how many times it is redelivered ("Rule: Redelivery is safe" in the spec).
 * Isolation is per record — one malformed or oversized sibling in a batch
 * never rejects the rest ("Rule: The server never tells a client to discard
 * data the server is holding" / "Only the sender's own malformed records
 * count as rejected").
 *
 * This module is a rewrite, not a port, of
 * `event-sourcing.old/pipelines/log-processing/canonicalLog.ts`: same
 * canonicalization algorithm (the behavioural contract the spec pins down),
 * reorganized into smaller named steps, and without the two cross-pipeline
 * dependencies the old file carried on `trace-processing/utils` — see the
 * module docblocks on `flattenAttributes` and `normalizeWireId` below for
 * why those are reimplemented locally rather than imported.
 */

type UnknownRecord = Record<string, unknown>;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";
const CODEX_EVENT_NAME_PREFIX = "codex.";

/** The maximum size of one record's canonical payload, before it is rejected. */
export const MAX_CANONICAL_LOG_PAYLOAD_BYTES = 1024 * 1024;

/**
 * Deliberately NOT a generic `isRecord` that also accepts arrays
 * (`typeof [] === "object"`). An OTLP log body is an `AnyValue` union in
 * which `arrayValue` and `kvlistValue` are distinct cases; folding arrays
 * into the record branch would canonicalise a body array as an object and
 * change its `recordId`.
 */
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Bytewise comparison, never `localeCompare`. ICU collation inverts base62
 * ordering at the `Z` -> `a` step, so sorting attributes with `localeCompare`
 * would make the canonical form — and therefore `recordId` — depend on the
 * runtime's locale tables rather than the bytes themselves (ADR-098's
 * rationale for the same rule on event ids applies identically here: this is
 * a small, pure, self-contained comparator, not a dependency worth taking on
 * a pipeline still in `event-sourcing.old/`).
 */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic JSON: object keys sort; array order stays meaningful. */
function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (current: unknown): unknown => {
    if (current === undefined) return { $undefined: true };
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "number" && !Number.isFinite(current)) {
      return { $number: String(current) };
    }
    if (current instanceof Uint8Array) {
      return { $bytes: Buffer.from(current).toString("base64") };
    }
    if (Array.isArray(current)) return current.map(normalize);
    if (isRecord(current)) {
      if (seen.has(current))
        throw new Error("cannot canonicalize cyclic OTLP data");
      seen.add(current);
      const result: UnknownRecord = {};
      for (const key of Object.keys(current).sort()) {
        result[key] = normalize(current[key]);
      }
      seen.delete(current);
      return result;
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function longBitsToBigInt(value: UnknownRecord): bigint {
  const low = BigInt(Number(value.low ?? 0) >>> 0);
  const high = BigInt(Number(value.high ?? 0) >>> 0);
  return BigInt.asUintN(64, (high << 32n) | low);
}

function integerDecimal(value: unknown, label: string, max: bigint): string {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error(`${label} is not a safely represented unsigned integer`);
  }
  let decimal: string;
  if (typeof value === "bigint") decimal = value.toString();
  else if (typeof value === "string") decimal = value;
  else if (typeof value === "number") decimal = String(value);
  else if (isRecord(value) && "low" in value && "high" in value) {
    decimal = longBitsToBigInt(value).toString();
  } else {
    throw new Error(`${label} is not an integer`);
  }
  if (!/^\d+$/.test(decimal)) throw new Error(`${label} is not an integer`);
  const parsed = BigInt(decimal);
  if (parsed > max) throw new Error(`${label} is outside its OTLP range`);
  return parsed.toString();
}

function optionalTimestamp(value: unknown, label: string): string {
  if (value === undefined || value === null) return "0";
  return integerDecimal(value, label, MAX_UINT64);
}

function uint32Number(value: unknown, label: string): number {
  return Number(integerDecimal(value ?? 0, label, MAX_UINT32));
}

function timestampMs(timestamp: string): number {
  const ms = Number(BigInt(timestamp) / 1_000_000n);
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new Error(
      `OTLP timestamp is outside the supported range: ${timestamp}`,
    );
  }
  return ms;
}

// ---------------------------------------------------------------------------
// AnyValue canonicalization
// ---------------------------------------------------------------------------

/** The canonical, typed rendering of one OTLP `AnyValue`. */
export type CanonicalAnyValue =
  | { readonly type: "empty" }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "bool"; readonly value: boolean }
  | { readonly type: "int"; readonly value: string }
  | { readonly type: "double"; readonly value: number }
  | { readonly type: "bytes"; readonly value: string }
  | { readonly type: "array"; readonly value: readonly CanonicalAnyValue[] }
  | { readonly type: "kvlist"; readonly value: readonly CanonicalAttribute[] };

export interface CanonicalAttribute {
  readonly key: string;
  readonly value: CanonicalAnyValue;
}

/**
 * Preserves an `AnyValue`'s type and shape exactly — the whole point of
 * "Rule: Log structure survives ingestion". Anything not cleanly one of
 * OTLP's seven cases is a rejection, not a best-effort coercion: a structured
 * body that half-parses is worse than one that is loudly refused.
 */
function canonicalAnyValue(value: unknown): CanonicalAnyValue {
  if (!isRecord(value)) return { type: "empty" };
  const present = [
    "stringValue",
    "boolValue",
    "intValue",
    "doubleValue",
    "bytesValue",
    "arrayValue",
    "kvlistValue",
  ].filter((key) => value[key] !== undefined && value[key] !== null);
  if (present.length === 0) return { type: "empty" };
  if (present.length > 1)
    throw new Error("OTLP AnyValue contains multiple values");
  const kind = present[0]!;

  if (kind === "stringValue") {
    if (typeof value.stringValue !== "string")
      throw new Error("stringValue must be a string");
    return { type: "string", value: value.stringValue };
  }
  if (kind === "boolValue") {
    const bool = value.boolValue;
    if (typeof bool === "boolean") return { type: "bool", value: bool };
    if (bool === "true" || bool === "false")
      return { type: "bool", value: bool === "true" };
    throw new Error("boolValue must be a boolean");
  }
  if (kind === "intValue") {
    const raw = value.intValue;
    if (typeof raw === "number" && !Number.isSafeInteger(raw)) {
      throw new Error("intValue is not safely represented");
    }
    if (isRecord(raw) && "low" in raw && "high" in raw) {
      const low = BigInt(Number(raw.low ?? 0) >>> 0);
      const high = BigInt(Number(raw.high ?? 0) >>> 0);
      return {
        type: "int",
        value: BigInt.asIntN(64, (high << 32n) | low).toString(),
      };
    }
    const decimal = String(raw);
    if (!/^-?\d+$/.test(decimal)) throw new Error("intValue is not an integer");
    return { type: "int", value: BigInt(decimal).toString() };
  }
  if (kind === "doubleValue") {
    const number = Number(value.doubleValue);
    if (!Number.isFinite(number)) throw new Error("doubleValue must be finite");
    return { type: "double", value: number };
  }
  if (kind === "bytesValue") {
    const raw = value.bytesValue;
    if (typeof raw === "string") {
      const unpadded = raw.replace(/=+$/, "");
      const roundTrip = Buffer.from(raw, "base64")
        .toString("base64")
        .replace(/=+$/, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || roundTrip !== unpadded) {
        throw new Error("bytesValue is not valid base64");
      }
    }
    const bytes =
      raw instanceof Uint8Array
        ? raw
        : typeof raw === "string"
          ? Buffer.from(raw, "base64")
          : isRecord(raw)
            ? Buffer.from(
                Object.entries(raw)
                  .sort(([left], [right]) => Number(left) - Number(right))
                  .map(([, byte]) => Number(byte)),
              )
            : null;
    if (!bytes) throw new Error("bytesValue is malformed");
    return { type: "bytes", value: Buffer.from(bytes).toString("base64") };
  }
  if (kind === "arrayValue") {
    const array = value.arrayValue;
    if (!isRecord(array) || !Array.isArray(array.values))
      throw new Error("arrayValue is malformed");
    return {
      type: "array",
      value: array.values.map((item) => canonicalAnyValue(item)),
    };
  }
  const list = value.kvlistValue;
  if (!isRecord(list) || !Array.isArray(list.values))
    throw new Error("kvlistValue is malformed");
  return { type: "kvlist", value: canonicalAttributes(list.values) };
}

/**
 * Canonicalizes an attribute list: each value keeps its OTLP type, and the
 * list is sorted (key, then a stable stringification of the value) so two
 * wire deliveries of the same logical attributes always produce the same
 * bytes — a redelivered batch must hash to the same `recordId`, and OTLP does
 * not itself guarantee attribute order on the wire.
 */
function canonicalAttributes(attributes: unknown): CanonicalAttribute[] {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((raw) => {
      if (!isRecord(raw) || typeof raw.key !== "string")
        throw new Error("attribute is malformed");
      return { key: raw.key, value: canonicalAnyValue(raw.value) };
    })
    .sort((left, right) => {
      const byKey = compareOrdinal(left.key, right.key);
      return (
        byKey ||
        compareOrdinal(
          stableStringify(left.value),
          stableStringify(right.value),
        )
      );
    });
}

/**
 * A flat `dot.path -> string` view of a canonical attribute list, used for
 * the record's `*AttributesFlatJson` columns and for the well-known scalar
 * keys correlation synthesis reads (`session.id`, `prompt.id`,
 * `conversation.id`, `event.sequence`, `event.name`).
 *
 * The old pipeline built this with `trace-processing/utils/traceRequest.utils
 * .normalizeOtlpAttributeMap` — a ~100-line, cross-pipeline OTLP flattener
 * (array reconstruction, then a JSON-string-parsing pass) shared with
 * trace/metric ingestion. That pipeline has not converted yet, so importing
 * it would be a dependency on code scheduled for deletion (ADR-102 decision
 * 5: a pipeline's dependencies point downward, never sideways into an
 * unconverted sibling). This is a smaller, self-contained reimplementation
 * derived directly from the `CanonicalAnyValue` tree this module already
 * builds for hashing, rather than a second independent flattening pass over
 * the raw OTLP wire shape. It is sufficient for what log-processing actually
 * needs — informational columns and a handful of always-scalar correlation
 * keys — but it is not a byte-for-byte match for the old flattener's output
 * on deeply nested or array-shaped attributes (its array-reconstruction and
 * embedded-JSON-string heuristics are not reproduced). Flagged rather than
 * silently ported: if a consumer needs that exact legacy shape, it needs the
 * shared flattener extracted to a location every OTLP-ingesting pipeline can
 * reach, which does not exist yet.
 */
function flattenAttributes(
  attributes: readonly CanonicalAttribute[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (prefix: string, value: CanonicalAnyValue): void => {
    switch (value.type) {
      case "empty":
        return;
      case "string":
        out[prefix] = value.value;
        return;
      case "bool":
        out[prefix] = String(value.value);
        return;
      case "int":
        out[prefix] = value.value;
        return;
      case "double":
        out[prefix] = String(value.value);
        return;
      case "bytes":
        out[prefix] = value.value;
        return;
      case "array":
        value.value.forEach((item, index) => visit(`${prefix}.${index}`, item));
        return;
      case "kvlist":
        for (const attr of value.value)
          visit(`${prefix}.${attr.key}`, attr.value);
        return;
    }
  };
  for (const attr of attributes) visit(attr.key, attr.value);
  return out;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export interface LogRedactionService {
  redactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
}

type StringRef = { owner: UnknownRecord; key: string; path: string };

function collectStringRefs(
  value: unknown,
  prefix: string,
  refs: StringRef[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectStringRefs(child, `${prefix}.${index}`, refs),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "stringValue" && typeof child === "string") {
      refs.push({ owner: value, key, path });
    } else {
      collectStringRefs(child, path, refs);
    }
  }
}

/**
 * Redacts every nested `stringValue` in the raw wire node *before*
 * canonicalization sees it, so a redacted record's `recordId` is a hash of
 * the redacted content, never the raw one — a leak that survived only in the
 * hash would still be a leak.
 */
async function redactTypedLog(args: {
  resourceAttributes: unknown;
  scopeAttributes: unknown;
  logAttributes: unknown;
  body: unknown;
  redactionService: LogRedactionService;
  piiRedactionLevel: PIIRedactionLevel;
  tenantId: string;
}): Promise<void> {
  const refs: StringRef[] = [];
  collectStringRefs(args.resourceAttributes, "resource", refs);
  collectStringRefs(args.scopeAttributes, "scope", refs);
  collectStringRefs(args.logAttributes, "log", refs);
  collectStringRefs(args.body, "body", refs);
  const attributes = Object.fromEntries(
    refs.map((ref) => [ref.path, String(ref.owner[ref.key])]),
  );
  await args.redactionService.redactLog(
    { body: "", attributes, resourceAttributes: {} },
    args.piiRedactionLevel,
    args.tenantId,
  );
  for (const ref of refs) {
    const redacted = attributes[ref.path];
    if (redacted !== undefined) ref.owner[ref.key] = redacted;
  }
}

// ---------------------------------------------------------------------------
// Correlation synthesis
// ---------------------------------------------------------------------------

/**
 * Decodes a wire trace/span id (hex string, or raw bytes) to lowercase hex.
 * Reimplemented locally rather than imported from `trace-processing/utils`
 * for the same reason as `flattenAttributes` above — it is one small, pure
 * step, not worth a dependency on an unconverted sibling pipeline.
 */
function normalizeWireId(value: unknown): string {
  if (value === undefined || value === null) return "";
  const decoded =
    value instanceof Uint8Array
      ? Buffer.from(value).toString("hex")
      : String(value);
  return decoded.toLowerCase();
}

interface Correlation {
  readonly traceId: string;
  readonly spanId: string;
  readonly source: LogCorrelationSource;
  readonly providerKind: LogProviderKind;
}

/**
 * "Rule: Useful agent logs reach the trace they belong to" — a record with no
 * wire trace/span id is not simply left uncorrelated when it carries
 * recognisable coding-agent detail (a Claude Code `session.id`, a Codex
 * `conversation.id`): a stable trace/span id is derived from that detail so
 * the record still lands on the trace it belongs to.
 */
function synthesizeCorrelation(args: {
  scopeName: string;
  wireTraceId: string;
  wireSpanId: string;
  eventName: string;
  attributes: Record<string, string>;
}): Correlation {
  const { wireTraceId, wireSpanId, attributes, eventName } = args;
  const providerKind: LogProviderKind =
    args.scopeName === CLAUDE_CODE_EVENT_SCOPE
      ? "claude_code"
      : eventName.startsWith(CODEX_EVENT_NAME_PREFIX)
        ? "codex"
        : "generic";

  if (isValidTraceId(wireTraceId) && isValidSpanId(wireSpanId)) {
    return {
      traceId: wireTraceId,
      spanId: wireSpanId,
      source: "wire",
      providerKind,
    };
  }

  if (providerKind === "claude_code") {
    const sessionId = attributes["session.id"] ?? "";
    if (sessionId) {
      const promptId = attributes["prompt.id"] ?? "";
      const turnKey = promptId ? `${sessionId}:${promptId}` : sessionId;
      const traceId = isValidTraceId(wireTraceId)
        ? wireTraceId
        : sha256(turnKey).slice(0, 32);
      const spanId = isValidSpanId(wireSpanId)
        ? wireSpanId
        : sha256(
            `${sessionId}:${promptId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
          ).slice(0, 16);
      return { traceId, spanId, source: "claude_synthesized", providerKind };
    }
  }

  if (providerKind === "codex") {
    const conversationId = attributes["conversation.id"] ?? "";
    if (conversationId) {
      const traceId = isValidTraceId(wireTraceId)
        ? wireTraceId
        : sha256(conversationId).slice(0, 32);
      const spanId = isValidSpanId(wireSpanId)
        ? wireSpanId
        : sha256(
            `${conversationId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
          ).slice(0, 16);
      return { traceId, spanId, source: "codex_synthesized", providerKind };
    }
  }

  return { traceId: "", spanId: "", source: "none", providerKind };
}

// ---------------------------------------------------------------------------
// Record assembly
// ---------------------------------------------------------------------------

function bodyType(body: CanonicalAnyValue): CanonicalLogRecord["bodyType"] {
  return body.type;
}

function bodyText(body: CanonicalAnyValue): string | null {
  return body.type === "string" ? body.value : null;
}

export interface PreparedCanonicalLogRecord {
  readonly record: CanonicalLogRecord;
  readonly normalized: {
    readonly body: string;
    readonly attributes: Record<string, string>;
    readonly resourceAttributes: Record<string, string>;
    readonly scopeName: string;
    readonly scopeVersion: string | null;
  };
}

function buildRecord(args: {
  tenantId: string;
  organizationId: string;
  resourceLog: UnknownRecord;
  scopeLog: UnknownRecord;
  logRecord: UnknownRecord;
  piiRedactionLevel: PIIRedactionLevel;
  acceptedAt: number;
}): PreparedCanonicalLogRecord {
  const resource = isRecord(args.resourceLog.resource)
    ? args.resourceLog.resource
    : {};
  const scope = isRecord(args.scopeLog.scope) ? args.scopeLog.scope : {};
  const log = args.logRecord;
  const scopeName = typeof scope.name === "string" ? scope.name : "";
  const scopeVersion = typeof scope.version === "string" ? scope.version : "";
  const logAttributes = Array.isArray(log.attributes) ? log.attributes : [];
  log.attributes = logAttributes;

  const resourceAttributes = canonicalAttributes(resource.attributes);
  const scopeAttributes = canonicalAttributes(scope.attributes);
  const attributes = canonicalAttributes(log.attributes);
  const flatAttributes = flattenAttributes(attributes);
  const eventName =
    typeof log.eventName === "string"
      ? log.eventName
      : (flatAttributes["event.name"] ?? "");
  const flatResourceAttributes = flattenAttributes(resourceAttributes);

  const wireTraceId = normalizeWireId(log.traceId);
  const wireSpanId = normalizeWireId(log.spanId);
  const correlation = synthesizeCorrelation({
    scopeName,
    wireTraceId,
    wireSpanId,
    eventName,
    attributes: flatAttributes,
  });

  const timeUnixNano = optionalTimestamp(log.timeUnixNano, "timeUnixNano");
  const observedTimeUnixNano = optionalTimestamp(
    log.observedTimeUnixNano,
    "observedTimeUnixNano",
  );
  const effectiveTimestamp =
    timeUnixNano !== "0"
      ? timeUnixNano
      : observedTimeUnixNano !== "0"
        ? observedTimeUnixNano
        : String(BigInt(args.acceptedAt) * 1_000_000n);

  const flags = uint32Number(log.flags, "flags");
  const severityNumber = Number(
    integerDecimal(log.severityNumber ?? 0, "severityNumber", 255n),
  );
  const canonicalBody = canonicalAnyValue(log.body);

  const canonicalPayloadValue = {
    resource: {
      schemaUrl:
        typeof args.resourceLog.schemaUrl === "string"
          ? args.resourceLog.schemaUrl
          : "",
      droppedAttributesCount: uint32Number(
        resource.droppedAttributesCount,
        "resource.droppedAttributesCount",
      ),
      attributes: resourceAttributes,
    },
    scope: {
      schemaUrl:
        typeof args.scopeLog.schemaUrl === "string"
          ? args.scopeLog.schemaUrl
          : "",
      name: scopeName,
      version: scopeVersion,
      droppedAttributesCount: uint32Number(
        scope.droppedAttributesCount,
        "scope.droppedAttributesCount",
      ),
      attributes: scopeAttributes,
    },
    log: {
      wireTraceId,
      wireSpanId,
      timeUnixNano,
      observedTimeUnixNano,
      severityNumber,
      severityText:
        typeof log.severityText === "string" ? log.severityText : "",
      body: canonicalBody,
      attributes,
      droppedAttributesCount: uint32Number(
        log.droppedAttributesCount,
        "log.droppedAttributesCount",
      ),
      flags,
      eventName,
    },
  };

  const canonicalPayload = stableStringify(canonicalPayloadValue);
  const canonicalSizeBytes = Buffer.byteLength(canonicalPayload, "utf8");
  if (canonicalSizeBytes > MAX_CANONICAL_LOG_PAYLOAD_BYTES) {
    throw new RangeError(
      `canonical log payload is ${canonicalSizeBytes} bytes (maximum ${MAX_CANONICAL_LOG_PAYLOAD_BYTES})`,
    );
  }

  // Content-addressed: two deliveries of the same logical record hash to the
  // same id, which is what makes this pipeline's store idempotent under
  // redelivery without a separate dedup key (store.ts).
  const recordId = sha256(`${args.tenantId}\0${canonicalPayload}`);

  const record: CanonicalLogRecord = {
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    recordId,
    resourceSchemaUrl: canonicalPayloadValue.resource.schemaUrl,
    resourceAttributesJson: stableStringify(resourceAttributes),
    resourceAttributesFlatJson: stableStringify(flatResourceAttributes),
    resourceAttributeKeys: [...new Set(resourceAttributes.map((a) => a.key))],
    resourceDroppedAttributesCount:
      canonicalPayloadValue.resource.droppedAttributesCount,
    scopeSchemaUrl: canonicalPayloadValue.scope.schemaUrl,
    scopeName,
    scopeVersion,
    scopeAttributesJson: stableStringify(scopeAttributes),
    scopeAttributeKeys: [...new Set(scopeAttributes.map((a) => a.key))],
    scopeDroppedAttributesCount:
      canonicalPayloadValue.scope.droppedAttributesCount,
    wireTraceId,
    wireSpanId,
    correlationTraceId: correlation.traceId,
    correlationSpanId: correlation.spanId,
    correlationSource: correlation.source,
    timeUnixNano,
    observedTimeUnixNano,
    timeUnixMs: timestampMs(effectiveTimestamp),
    severityNumber,
    severityText: canonicalPayloadValue.log.severityText,
    bodyType: bodyType(canonicalBody),
    bodyJson: stableStringify(canonicalBody),
    bodyText: bodyText(canonicalBody),
    attributesJson: stableStringify(attributes),
    attributesFlatJson: stableStringify(flatAttributes),
    attributeKeys: [...new Set(attributes.map((a) => a.key))],
    droppedAttributesCount: canonicalPayloadValue.log.droppedAttributesCount,
    flags,
    eventName,
    providerKind: correlation.providerKind,
    providerEventKind: "",
    providerEventSequence: flatAttributes["event.sequence"] ?? "",
    providerSessionId: flatAttributes["session.id"] ?? "",
    providerConversationId: flatAttributes["conversation.id"] ?? "",
    providerPromptId: flatAttributes["prompt.id"] ?? "",
    piiRedactionLevel: args.piiRedactionLevel,
    canonicalPayload,
    canonicalSizeBytes,
    occurredAt: timestampMs(effectiveTimestamp),
    acceptedAt: args.acceptedAt,
  };

  return {
    record,
    normalized: {
      body: bodyText(canonicalBody) ?? stableStringify(canonicalBody),
      attributes: {
        ...flatAttributes,
        ...(eventName && !("event.name" in flatAttributes)
          ? { "event.name": eventName }
          : {}),
      },
      resourceAttributes: flatResourceAttributes,
      scopeName,
      scopeVersion: scopeVersion || null,
    },
  };
}

export interface CanonicalizationResult {
  readonly accepted: readonly PreparedCanonicalLogRecord[];
  readonly rejectedLogRecords: number;
  readonly errors: readonly string[];
}

/**
 * Canonicalizes one OTLP `ExportLogsServiceRequest` into records this
 * pipeline's aggregate can accept commands for.
 *
 * Per-record isolation is the load-bearing property: one malformed or
 * oversized log record is rejected and counted, and every sibling in the same
 * batch is still accepted — an OTLP `partialSuccess` response is a permanent
 * verdict, so treating a whole batch as rejected because of one bad record
 * would tell the sender to discard data we would otherwise have kept.
 */
export async function canonicalizeLogRequest(args: {
  tenantId: string;
  organizationId: string;
  request: DeepPartial<IExportLogsServiceRequest>;
  piiRedactionLevel: PIIRedactionLevel;
  redactionService: LogRedactionService;
  acceptedAt?: number;
}): Promise<CanonicalizationResult> {
  const accepted: PreparedCanonicalLogRecord[] = [];
  const errors: string[] = [];
  let rejectedLogRecords = 0;
  const acceptedAt = args.acceptedAt ?? Date.now();

  for (const resourceLogRaw of args.request.resourceLogs ?? []) {
    if (!resourceLogRaw) continue;
    const resourceLog = structuredClone(resourceLogRaw) as UnknownRecord;
    const resourceTemplate = isRecord(resourceLog.resource)
      ? resourceLog.resource
      : {};
    for (const scopeLogRaw of (resourceLog.scopeLogs as unknown[]) ?? []) {
      if (!scopeLogRaw) continue;
      const scopeLog = structuredClone(scopeLogRaw) as UnknownRecord;
      const scopeTemplate = isRecord(scopeLog.scope) ? scopeLog.scope : {};
      const logRecords = Array.isArray(scopeLog.logRecords)
        ? scopeLog.logRecords
        : [];
      for (const logRecordRaw of logRecords) {
        if (!isRecord(logRecordRaw)) {
          rejectedLogRecords++;
          errors.push("log record is malformed");
          continue;
        }
        const resource = structuredClone(resourceTemplate);
        const scope = structuredClone(scopeTemplate);
        const logRecord = structuredClone(logRecordRaw);
        try {
          await redactTypedLog({
            resourceAttributes: resource.attributes,
            scopeAttributes: scope.attributes,
            logAttributes: logRecord.attributes,
            body: logRecord.body,
            redactionService: args.redactionService,
            piiRedactionLevel: args.piiRedactionLevel,
            tenantId: args.tenantId,
          });
          accepted.push(
            buildRecord({
              tenantId: args.tenantId,
              organizationId: args.organizationId,
              resourceLog: { ...resourceLog, resource },
              scopeLog: { ...scopeLog, scope },
              logRecord,
              piiRedactionLevel: args.piiRedactionLevel,
              acceptedAt,
            }),
          );
        } catch (error) {
          rejectedLogRecords++;
          errors.push(
            `log record: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
  return { accepted, rejectedLogRecords, errors };
}
