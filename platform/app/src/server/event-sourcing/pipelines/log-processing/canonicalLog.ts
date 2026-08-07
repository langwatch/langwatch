import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import type { DeepPartial } from "~/utils/types";
import { compareOrdinal } from "../../utils/compareOrdinal";
import {
  sha256,
  stableStringify,
} from "../metric-processing/canonical/serialization";
import type { PIIRedactionLevel } from "../trace-processing/schemas/commands";
import type { OtlpKeyValue } from "../trace-processing/schemas/otlp";
import {
  normalizeOtlpAttributeMap,
  TraceRequestUtils,
} from "../trace-processing/utils/traceRequest.utils";
import {
  DEFAULT_LOG_COMMAND_SHARDS,
  MAX_CANONICAL_LOG_PAYLOAD_BYTES,
  MAX_LOG_COMMAND_SHARDS,
  MIN_LOG_COMMAND_SHARDS,
} from "./schemas/constants";
import type {
  CanonicalLogRecord,
  LogCorrelationSource,
  LogProviderKind,
} from "./schemas/logRecord";

type UnknownRecord = Record<string, unknown>;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";
const CODEX_EVENT_NAME_PREFIX = "codex.";

export type LogRedactionService = {
  redactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
};

export interface PreparedCanonicalLogRecord {
  record: CanonicalLogRecord;
  normalized: {
    body: string;
    attributes: Record<string, string>;
    resourceAttributes: Record<string, string>;
    scopeName: string;
    scopeVersion: string | null;
  };
}

export interface CanonicalLogPreparationResult {
  accepted: PreparedCanonicalLogRecord[];
  rejectedLogRecords: number;
  errors: string[];
}

/**
 * Deliberately NOT serialization.isRecord, which treats arrays as records
 * (`typeof [] === "object"`). OTLP log bodies are an AnyValue union in which
 * arrayValue and kvlistValue are distinct cases, so folding arrays into the
 * record branch would canonicalise a body array as an object and change its
 * RecordId. Keep the two apart; do not "share" them.
 */
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function longBitsToBigInt(value: UnknownRecord): bigint {
  const low = BigInt(Number(value.low ?? 0) >>> 0);
  const high = BigInt(Number(value.high ?? 0) >>> 0);
  return BigInt.asUintN(64, (high << 32n) | low);
}

function decimalFromValue(value: unknown, label: string): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isRecord(value) && "low" in value && "high" in value) {
    return longBitsToBigInt(value).toString();
  }
  throw new Error(`${label} is not an integer`);
}

function integerDecimal(value: unknown, label: string, max: bigint): string {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error(`${label} is not a safely represented unsigned integer`);
  }
  const decimal = decimalFromValue(value, label);
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

const ANY_VALUE_KEYS = [
  "stringValue",
  "boolValue",
  "intValue",
  "doubleValue",
  "bytesValue",
  "arrayValue",
  "kvlistValue",
] as const;

function presentAnyValueKeys(value: UnknownRecord): string[] {
  return ANY_VALUE_KEYS.filter(
    (key) => value[key] !== undefined && value[key] !== null,
  );
}

function canonicalStringValue(value: UnknownRecord): unknown {
  if (typeof value.stringValue !== "string") {
    throw new Error("stringValue must be a string");
  }
  return { type: "string", value: value.stringValue };
}

function canonicalBoolValue(value: UnknownRecord): unknown {
  const bool = value.boolValue;
  if (typeof bool === "boolean") return { type: "bool", value: bool };
  if (bool === "true" || bool === "false") {
    return { type: "bool", value: bool === "true" };
  }
  throw new Error("boolValue must be a boolean");
}

function canonicalIntValue(value: UnknownRecord): unknown {
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

function canonicalDoubleValue(value: UnknownRecord): unknown {
  const number = Number(value.doubleValue);
  if (!Number.isFinite(number)) throw new Error("doubleValue must be finite");
  return { type: "double", value: number };
}

function assertValidBase64BytesValue(raw: string): void {
  const unpadded = raw.replace(/=+$/, "");
  const roundTrip = Buffer.from(raw, "base64")
    .toString("base64")
    .replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || roundTrip !== unpadded) {
    throw new Error("bytesValue is not valid base64");
  }
}

function decodeBytesValue(raw: unknown): Uint8Array | Buffer | null {
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw === "string") return Buffer.from(raw, "base64");
  if (isRecord(raw)) {
    return Buffer.from(
      Object.entries(raw)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, byte]) => Number(byte)),
    );
  }
  return null;
}

function canonicalBytesValue(value: UnknownRecord): unknown {
  const raw = value.bytesValue;
  if (typeof raw === "string") assertValidBase64BytesValue(raw);
  const bytes = decodeBytesValue(raw);
  if (!bytes) throw new Error("bytesValue is malformed");
  return { type: "bytes", value: Buffer.from(bytes).toString("base64") };
}

function canonicalArrayValue(value: UnknownRecord): unknown {
  const array = value.arrayValue;
  if (!isRecord(array) || !Array.isArray(array.values)) {
    throw new Error("arrayValue is malformed");
  }
  return {
    type: "array",
    value: array.values.map((item) => canonicalAnyValue(item)),
  };
}

function canonicalKvlistValue(value: UnknownRecord): unknown {
  const list = value.kvlistValue;
  if (!isRecord(list) || !Array.isArray(list.values)) {
    throw new Error("kvlistValue is malformed");
  }
  return { type: "kvlist", value: canonicalAttributes(list.values) };
}

function canonicalAnyValue(value: unknown): unknown {
  if (!isRecord(value)) return { type: "empty" };
  const present = presentAnyValueKeys(value);
  if (present.length === 0) return { type: "empty" };
  if (present.length > 1)
    throw new Error("OTLP AnyValue contains multiple values");
  const kind = present[0]!;
  if (kind === "stringValue") return canonicalStringValue(value);
  if (kind === "boolValue") return canonicalBoolValue(value);
  if (kind === "intValue") return canonicalIntValue(value);
  if (kind === "doubleValue") return canonicalDoubleValue(value);
  if (kind === "bytesValue") return canonicalBytesValue(value);
  if (kind === "arrayValue") return canonicalArrayValue(value);
  return canonicalKvlistValue(value);
}

function canonicalAttributes(
  attributes: unknown,
): Array<{ key: string; value: unknown }> {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((raw) => {
      if (!isRecord(raw) || typeof raw.key !== "string") {
        throw new Error("attribute is malformed");
      }
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

type StringRef = { owner: UnknownRecord; key: string; path: string };

function collectStringRefs(value: unknown, prefix: string, refs: StringRef[]) {
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

async function redactTypedLog(args: {
  resourceAttributes: unknown;
  scopeAttributes: unknown;
  logAttributes: unknown;
  body: unknown;
  redactionService: LogRedactionService;
  piiRedactionLevel: PIIRedactionLevel;
  tenantId: string;
}) {
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

function normalizeId(value: unknown): string {
  if (value === undefined || value === null) return "";
  return (
    TraceRequestUtils.normalizeOtlpId(value as string | Uint8Array) ?? ""
  ).toLowerCase();
}

function validTraceId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value) && !/^0+$/.test(value);
}

function validSpanId(value: string): boolean {
  return /^[a-f0-9]{16}$/.test(value) && !/^0+$/.test(value);
}

function resolveProviderKind(
  scopeName: string,
  eventName: string,
): LogProviderKind {
  if (scopeName === CLAUDE_CODE_EVENT_SCOPE) return "claude_code";
  if (eventName.startsWith(CODEX_EVENT_NAME_PREFIX)) return "codex";
  return "generic";
}

function synthesizeClaudeCodeCorrelation(args: {
  wireTraceId: string;
  wireSpanId: string;
  eventName: string;
  attributes: Record<string, string>;
}): { traceId: string; spanId: string; source: LogCorrelationSource } | null {
  const { wireTraceId, wireSpanId, eventName, attributes } = args;
  const sessionId = attributes["session.id"] ?? "";
  if (!sessionId) return null;
  const promptId = attributes["prompt.id"] ?? "";
  const turnKey = promptId ? `${sessionId}:${promptId}` : sessionId;
  const traceId = validTraceId(wireTraceId)
    ? wireTraceId
    : sha256(turnKey).slice(0, 32);
  const spanId = validSpanId(wireSpanId)
    ? wireSpanId
    : sha256(
        `${sessionId}:${promptId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
      ).slice(0, 16);
  return { traceId, spanId, source: "claude_synthesized" };
}

function synthesizeCodexCorrelation(args: {
  wireTraceId: string;
  wireSpanId: string;
  eventName: string;
  attributes: Record<string, string>;
}): { traceId: string; spanId: string; source: LogCorrelationSource } | null {
  const { wireTraceId, wireSpanId, eventName, attributes } = args;
  const conversationId = attributes["conversation.id"] ?? "";
  if (!conversationId) return null;
  const traceId = validTraceId(wireTraceId)
    ? wireTraceId
    : sha256(conversationId).slice(0, 32);
  const spanId = validSpanId(wireSpanId)
    ? wireSpanId
    : sha256(
        `${conversationId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
      ).slice(0, 16);
  return { traceId, spanId, source: "codex_synthesized" };
}

function synthesizeCorrelation(args: {
  scopeName: string;
  wireTraceId: string;
  wireSpanId: string;
  eventName: string;
  attributes: Record<string, string>;
}): {
  traceId: string;
  spanId: string;
  source: LogCorrelationSource;
  providerKind: LogProviderKind;
} {
  const { wireTraceId, wireSpanId, attributes, eventName } = args;
  const providerKind = resolveProviderKind(args.scopeName, eventName);
  if (validTraceId(wireTraceId) && validSpanId(wireSpanId)) {
    return {
      traceId: wireTraceId,
      spanId: wireSpanId,
      source: "wire",
      providerKind,
    };
  }
  if (providerKind === "claude_code") {
    const synthesized = synthesizeClaudeCodeCorrelation({
      wireTraceId,
      wireSpanId,
      eventName,
      attributes,
    });
    if (synthesized) return { ...synthesized, providerKind };
  }
  if (providerKind === "codex") {
    const synthesized = synthesizeCodexCorrelation({
      wireTraceId,
      wireSpanId,
      eventName,
      attributes,
    });
    if (synthesized) return { ...synthesized, providerKind };
  }
  return { traceId: "", spanId: "", source: "none", providerKind };
}

function bodyType(body: unknown): CanonicalLogRecord["bodyType"] {
  return (
    isRecord(body) && typeof body.type === "string" ? body.type : "empty"
  ) as CanonicalLogRecord["bodyType"];
}

function bodyText(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (body.type === "string" && typeof body.value === "string") {
    return body.value;
  }
  return null;
}

function deriveLogAttributes(args: {
  resourceLog: UnknownRecord;
  scopeLog: UnknownRecord;
  logRecord: UnknownRecord;
}) {
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
  const flatAttributes = normalizeOtlpAttributeMap(
    log.attributes as OtlpKeyValue[],
  );
  const eventName =
    typeof log.eventName === "string"
      ? log.eventName
      : (flatAttributes["event.name"] ?? "");
  const flatResourceAttributes = normalizeOtlpAttributeMap(
    resource.attributes as OtlpKeyValue[],
  );

  return {
    resource,
    scope,
    log,
    scopeName,
    scopeVersion,
    resourceAttributes,
    scopeAttributes,
    attributes,
    flatAttributes,
    flatResourceAttributes,
    eventName,
  };
}

function resolveLogTimestamps(args: {
  log: UnknownRecord;
  acceptedAt: number;
}): {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  effectiveTimestamp: string;
} {
  const timeUnixNano = optionalTimestamp(args.log.timeUnixNano, "timeUnixNano");
  const observedTimeUnixNano = optionalTimestamp(
    args.log.observedTimeUnixNano,
    "observedTimeUnixNano",
  );
  const effectiveTimestamp =
    timeUnixNano !== "0"
      ? timeUnixNano
      : observedTimeUnixNano !== "0"
        ? observedTimeUnixNano
        : String(BigInt(args.acceptedAt) * 1_000_000n);
  return { timeUnixNano, observedTimeUnixNano, effectiveTimestamp };
}

function deriveLogTimingAndScalars(args: {
  log: UnknownRecord;
  acceptedAt: number;
}): {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  effectiveTimestamp: string;
  flags: number;
  severityNumber: number;
  canonicalBody: unknown;
} {
  return {
    ...resolveLogTimestamps(args),
    ...deriveLogScalars(args.log),
  };
}

function buildCanonicalPayloadValue(args: {
  resourceLog: UnknownRecord;
  scopeLog: UnknownRecord;
  derived: ReturnType<typeof deriveLogAttributes>;
  wireTraceId: string;
  wireSpanId: string;
  metrics: ReturnType<typeof deriveLogTimingAndScalars>;
}) {
  const { derived, metrics } = args;
  return {
    resource: {
      schemaUrl:
        typeof args.resourceLog.schemaUrl === "string"
          ? args.resourceLog.schemaUrl
          : "",
      droppedAttributesCount: uint32Number(
        derived.resource.droppedAttributesCount,
        "resource.droppedAttributesCount",
      ),
      attributes: derived.resourceAttributes,
    },
    scope: {
      schemaUrl:
        typeof args.scopeLog.schemaUrl === "string"
          ? args.scopeLog.schemaUrl
          : "",
      name: derived.scopeName,
      version: derived.scopeVersion,
      droppedAttributesCount: uint32Number(
        derived.scope.droppedAttributesCount,
        "scope.droppedAttributesCount",
      ),
      attributes: derived.scopeAttributes,
    },
    log: {
      wireTraceId: args.wireTraceId,
      wireSpanId: args.wireSpanId,
      timeUnixNano: metrics.timeUnixNano,
      observedTimeUnixNano: metrics.observedTimeUnixNano,
      severityNumber: metrics.severityNumber,
      severityText:
        typeof derived.log.severityText === "string"
          ? derived.log.severityText
          : "",
      body: metrics.canonicalBody,
      attributes: derived.attributes,
      droppedAttributesCount: uint32Number(
        derived.log.droppedAttributesCount,
        "log.droppedAttributesCount",
      ),
      flags: metrics.flags,
      eventName: derived.eventName,
    },
  };
}

function buildCanonicalLogRecordRow(args: {
  tenantId: string;
  organizationId: string;
  recordId: string;
  canonicalPayloadValue: ReturnType<typeof buildCanonicalPayloadValue>;
  derived: ReturnType<typeof deriveLogAttributes>;
  wireTraceId: string;
  wireSpanId: string;
  correlation: ReturnType<typeof synthesizeCorrelation>;
  metrics: ReturnType<typeof deriveLogTimingAndScalars>;
  piiRedactionLevel: PIIRedactionLevel;
  canonicalPayload: string;
  canonicalSizeBytes: number;
  acceptedAt: number;
}): CanonicalLogRecord {
  const { derived, metrics } = args;
  return {
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    recordId: args.recordId,
    resourceSchemaUrl: args.canonicalPayloadValue.resource.schemaUrl,
    resourceAttributesJson: stableStringify(derived.resourceAttributes),
    resourceAttributesFlatJson: stableStringify(derived.flatResourceAttributes),
    resourceAttributeKeys: [
      ...new Set(derived.resourceAttributes.map((a) => a.key)),
    ],
    resourceDroppedAttributesCount:
      args.canonicalPayloadValue.resource.droppedAttributesCount,
    scopeSchemaUrl: args.canonicalPayloadValue.scope.schemaUrl,
    scopeName: derived.scopeName,
    scopeVersion: derived.scopeVersion,
    scopeAttributesJson: stableStringify(derived.scopeAttributes),
    scopeAttributeKeys: [...new Set(derived.scopeAttributes.map((a) => a.key))],
    scopeDroppedAttributesCount:
      args.canonicalPayloadValue.scope.droppedAttributesCount,
    wireTraceId: args.wireTraceId,
    wireSpanId: args.wireSpanId,
    correlationTraceId: args.correlation.traceId,
    correlationSpanId: args.correlation.spanId,
    correlationSource: args.correlation.source,
    timeUnixNano: metrics.timeUnixNano,
    observedTimeUnixNano: metrics.observedTimeUnixNano,
    timeUnixMs: timestampMs(metrics.effectiveTimestamp),
    severityNumber: metrics.severityNumber,
    severityText: args.canonicalPayloadValue.log.severityText,
    bodyType: bodyType(metrics.canonicalBody),
    bodyJson: stableStringify(metrics.canonicalBody),
    bodyText: bodyText(metrics.canonicalBody),
    attributesJson: stableStringify(derived.attributes),
    attributesFlatJson: stableStringify(derived.flatAttributes),
    attributeKeys: [...new Set(derived.attributes.map((a) => a.key))],
    droppedAttributesCount:
      args.canonicalPayloadValue.log.droppedAttributesCount,
    flags: metrics.flags,
    eventName: derived.eventName,
    providerKind: args.correlation.providerKind,
    // Deliberately empty. This once carried the claude span-kind
    // (model/tool/turn) that the log-to-span converter classified logs by;
    // that converter is retired (ADR-056) and agent-specific vocabulary now
    // lives in the coding-agent pipeline's normalization, not in the generic
    // log pipeline (§7). The column stays (migration 00050 is deployed) but
    // has no populating source or reader.
    providerEventKind: "",
    providerEventSequence: derived.flatAttributes["event.sequence"] ?? "",
    providerSessionId: derived.flatAttributes["session.id"] ?? "",
    providerConversationId: derived.flatAttributes["conversation.id"] ?? "",
    providerPromptId: derived.flatAttributes["prompt.id"] ?? "",
    piiRedactionLevel: args.piiRedactionLevel,
    canonicalPayload: args.canonicalPayload,
    canonicalSizeBytes: args.canonicalSizeBytes,
    occurredAt: timestampMs(metrics.effectiveTimestamp),
    acceptedAt: args.acceptedAt,
  };
}

function sealCanonicalPayload(args: {
  tenantId: string;
  canonicalPayloadValue: ReturnType<typeof buildCanonicalPayloadValue>;
  canonicalBody: unknown;
}): {
  canonicalPayload: string;
  canonicalSizeBytes: number;
  recordId: string;
  normalizedBody: string;
} {
  const canonicalPayload = stableStringify(args.canonicalPayloadValue);
  const canonicalSizeBytes = Buffer.byteLength(canonicalPayload, "utf8");
  if (canonicalSizeBytes > MAX_CANONICAL_LOG_PAYLOAD_BYTES) {
    throw new RangeError(
      `canonical log payload is ${canonicalSizeBytes} bytes (maximum ${MAX_CANONICAL_LOG_PAYLOAD_BYTES})`,
    );
  }
  const recordId = sha256(`${args.tenantId}\0${canonicalPayload}`);
  const normalizedBody =
    bodyText(args.canonicalBody) ?? stableStringify(args.canonicalBody);
  return { canonicalPayload, canonicalSizeBytes, recordId, normalizedBody };
}

function buildNormalizedLogAttributes(args: {
  flatAttributes: Record<string, string>;
  eventName: string;
}): Record<string, string> {
  return {
    ...args.flatAttributes,
    ...(args.eventName && !("event.name" in args.flatAttributes)
      ? { "event.name": args.eventName }
      : {}),
  };
}

function resolveWireIds(log: UnknownRecord): {
  wireTraceId: string;
  wireSpanId: string;
} {
  return {
    wireTraceId: normalizeId(log.traceId),
    wireSpanId: normalizeId(log.spanId),
  };
}

function deriveLogScalars(log: UnknownRecord): {
  flags: number;
  severityNumber: number;
  canonicalBody: unknown;
} {
  return {
    flags: uint32Number(log.flags, "flags"),
    severityNumber: Number(
      integerDecimal(log.severityNumber ?? 0, "severityNumber", 255n),
    ),
    canonicalBody: canonicalAnyValue(log.body),
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
  const derived = deriveLogAttributes({
    resourceLog: args.resourceLog,
    scopeLog: args.scopeLog,
    logRecord: args.logRecord,
  });
  const { wireTraceId, wireSpanId } = resolveWireIds(derived.log);
  const correlation = synthesizeCorrelation({
    scopeName: derived.scopeName,
    wireTraceId,
    wireSpanId,
    eventName: derived.eventName,
    attributes: derived.flatAttributes,
  });
  const metrics = deriveLogTimingAndScalars({
    log: derived.log,
    acceptedAt: args.acceptedAt,
  });
  const canonicalPayloadValue = buildCanonicalPayloadValue({
    resourceLog: args.resourceLog,
    scopeLog: args.scopeLog,
    derived,
    wireTraceId,
    wireSpanId,
    metrics,
  });
  const { canonicalPayload, canonicalSizeBytes, recordId, normalizedBody } =
    sealCanonicalPayload({
      tenantId: args.tenantId,
      canonicalPayloadValue,
      canonicalBody: metrics.canonicalBody,
    });
  const record = buildCanonicalLogRecordRow({
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    recordId,
    canonicalPayloadValue,
    derived,
    wireTraceId,
    wireSpanId,
    correlation,
    metrics,
    piiRedactionLevel: args.piiRedactionLevel,
    canonicalPayload,
    canonicalSizeBytes,
    acceptedAt: args.acceptedAt,
  });
  return {
    record,
    normalized: {
      body: normalizedBody,
      attributes: buildNormalizedLogAttributes({
        flatAttributes: derived.flatAttributes,
        eventName: derived.eventName,
      }),
      resourceAttributes: derived.flatResourceAttributes,
      scopeName: derived.scopeName,
      scopeVersion: derived.scopeVersion || null,
    },
  };
}

async function processLogRecord(args: {
  tenantId: string;
  organizationId: string;
  resourceLog: UnknownRecord;
  scopeLog: UnknownRecord;
  resourceTemplate: UnknownRecord;
  scopeTemplate: UnknownRecord;
  logRecordRaw: unknown;
  piiRedactionLevel: PIIRedactionLevel;
  redactionService: LogRedactionService;
  acceptedAt: number;
}): Promise<{ accepted?: PreparedCanonicalLogRecord; error?: string }> {
  if (!isRecord(args.logRecordRaw)) {
    return { error: "log record is malformed" };
  }
  const resource = structuredClone(args.resourceTemplate);
  const scope = structuredClone(args.scopeTemplate);
  const logRecord = structuredClone(args.logRecordRaw);
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
    const accepted = buildRecord({
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      resourceLog: { ...args.resourceLog, resource },
      scopeLog: { ...args.scopeLog, scope },
      logRecord,
      piiRedactionLevel: args.piiRedactionLevel,
      acceptedAt: args.acceptedAt,
    });
    return { accepted };
  } catch (error) {
    return {
      error: `log record: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function processScopeLog(args: {
  tenantId: string;
  organizationId: string;
  resourceLog: UnknownRecord;
  resourceTemplate: UnknownRecord;
  scopeLogRaw: unknown;
  piiRedactionLevel: PIIRedactionLevel;
  redactionService: LogRedactionService;
  acceptedAt: number;
}): Promise<{
  accepted: PreparedCanonicalLogRecord[];
  rejected: number;
  errors: string[];
}> {
  const accepted: PreparedCanonicalLogRecord[] = [];
  const errors: string[] = [];
  let rejected = 0;
  if (!args.scopeLogRaw) {
    return { accepted, rejected, errors };
  }
  const scopeLog = structuredClone(args.scopeLogRaw) as UnknownRecord;
  const scopeTemplate = isRecord(scopeLog.scope) ? scopeLog.scope : {};
  const logRecords = Array.isArray(scopeLog.logRecords)
    ? scopeLog.logRecords
    : [];
  for (const logRecordRaw of logRecords) {
    const result = await processLogRecord({
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      resourceLog: args.resourceLog,
      scopeLog,
      resourceTemplate: args.resourceTemplate,
      scopeTemplate,
      logRecordRaw,
      piiRedactionLevel: args.piiRedactionLevel,
      redactionService: args.redactionService,
      acceptedAt: args.acceptedAt,
    });
    if (result.accepted) accepted.push(result.accepted);
    if (result.error) {
      rejected++;
      errors.push(result.error);
    }
  }
  return { accepted, rejected, errors };
}

export async function prepareCanonicalLogRecords(args: {
  tenantId: string;
  organizationId: string;
  request: DeepPartial<IExportLogsServiceRequest>;
  piiRedactionLevel: PIIRedactionLevel;
  redactionService: LogRedactionService;
  acceptedAt?: number;
}): Promise<CanonicalLogPreparationResult> {
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
      const result = await processScopeLog({
        tenantId: args.tenantId,
        organizationId: args.organizationId,
        resourceLog,
        resourceTemplate,
        scopeLogRaw,
        piiRedactionLevel: args.piiRedactionLevel,
        redactionService: args.redactionService,
        acceptedAt,
      });
      accepted.push(...result.accepted);
      rejectedLogRecords += result.rejected;
      errors.push(...result.errors);
    }
  }
  return { accepted, rejectedLogRecords, errors };
}

export function clampLogCommandShardCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_LOG_COMMAND_SHARDS;
  return Math.min(
    MAX_LOG_COMMAND_SHARDS,
    Math.max(MIN_LOG_COMMAND_SHARDS, Math.trunc(value)),
  );
}

export function resolveLogCommandShardCount(value: string | undefined): number {
  if (!value) return DEFAULT_LOG_COMMAND_SHARDS;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clampLogCommandShardCount(parsed)
    : DEFAULT_LOG_COMMAND_SHARDS;
}

export function logCommandGroupKey(
  recordId: string,
  shardCount: number,
): string {
  const count = BigInt(clampLogCommandShardCount(shardCount));
  const lane = BigInt(`0x${sha256(recordId).slice(0, 16)}`) % count;
  return `log:${lane}`;
}
