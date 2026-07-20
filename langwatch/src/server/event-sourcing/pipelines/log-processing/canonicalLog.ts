import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import {
  CLAUDE_CODE_KIND_ATTR,
  CLAUDE_CODE_PII_ATTR,
  claudeCodeLogKind,
} from "~/server/app-layer/traces/claude-code-log-marking";
import type { DeepPartial } from "~/utils/types";
import {
  compareOrdinal,
  sha256,
  stableStringify,
} from "../metric-processing/canonical/serialization";
import type { PIIRedactionLevel } from "../trace-processing/schemas/commands";
import type {
  OtlpAnyValue,
  OtlpKeyValue,
} from "../trace-processing/schemas/otlp";
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

function canonicalAnyValue(value: unknown): unknown {
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
    if (typeof value.stringValue !== "string") {
      throw new Error("stringValue must be a string");
    }
    return { type: "string", value: value.stringValue };
  }
  if (kind === "boolValue") {
    const bool = value.boolValue;
    if (typeof bool === "boolean") return { type: "bool", value: bool };
    if (bool === "true" || bool === "false") {
      return { type: "bool", value: bool === "true" };
    }
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
    if (!isRecord(array) || !Array.isArray(array.values)) {
      throw new Error("arrayValue is malformed");
    }
    return {
      type: "array",
      value: array.values.map((item) => canonicalAnyValue(item)),
    };
  }
  const list = value.kvlistValue;
  if (!isRecord(list) || !Array.isArray(list.values)) {
    throw new Error("kvlistValue is malformed");
  }
  return { type: "kvlist", value: canonicalAttributes(list.values) };
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
  const { wireTraceId, wireSpanId, attributes } = args;
  const eventName = args.eventName;
  const providerKind: LogProviderKind =
    args.scopeName === CLAUDE_CODE_EVENT_SCOPE
      ? "claude_code"
      : eventName.startsWith(CODEX_EVENT_NAME_PREFIX)
        ? "codex"
        : "generic";
  if (validTraceId(wireTraceId) && validSpanId(wireSpanId)) {
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
      const traceId = validTraceId(wireTraceId)
        ? wireTraceId
        : sha256(turnKey).slice(0, 32);
      const spanId = validSpanId(wireSpanId)
        ? wireSpanId
        : sha256(
            `${sessionId}:${promptId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
          ).slice(0, 16);
      return {
        traceId,
        spanId,
        source: "claude_synthesized",
        providerKind,
      };
    }
  }
  if (providerKind === "codex") {
    const conversationId = attributes["conversation.id"] ?? "";
    if (conversationId) {
      const traceId = validTraceId(wireTraceId)
        ? wireTraceId
        : sha256(conversationId).slice(0, 32);
      const spanId = validSpanId(wireSpanId)
        ? wireSpanId
        : sha256(
            `${conversationId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
          ).slice(0, 16);
      return {
        traceId,
        spanId,
        source: "codex_synthesized",
        providerKind,
      };
    }
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

function appendStringAttribute(
  attributes: unknown[],
  key: string,
  value: string,
) {
  attributes.push({ key, value: { stringValue: value } });
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
  const flatBeforeMarkers = normalizeOtlpAttributeMap(
    logAttributes as OtlpKeyValue[],
  );
  const eventName =
    typeof log.eventName === "string"
      ? log.eventName
      : (flatBeforeMarkers["event.name"] ?? "");
  const claudeKind = claudeCodeLogKind(scopeName, eventName);
  if (claudeKind) {
    appendStringAttribute(logAttributes, CLAUDE_CODE_KIND_ATTR, claudeKind);
    appendStringAttribute(
      logAttributes,
      CLAUDE_CODE_PII_ATTR,
      args.piiRedactionLevel,
    );
  }
  log.attributes = logAttributes;

  const resourceAttributes = canonicalAttributes(resource.attributes);
  const scopeAttributes = canonicalAttributes(scope.attributes);
  const attributes = canonicalAttributes(log.attributes);
  const flatAttributes = normalizeOtlpAttributeMap(
    log.attributes as OtlpKeyValue[],
  );
  const flatResourceAttributes = normalizeOtlpAttributeMap(
    resource.attributes as OtlpKeyValue[],
  );
  const wireTraceId = normalizeId(log.traceId);
  const wireSpanId = normalizeId(log.spanId);
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
  const recordId = sha256(`${args.tenantId}\0${canonicalPayload}`);
  const normalizedBody =
    bodyText(canonicalBody) ?? stableStringify(canonicalBody);
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
    providerEventKind: claudeKind ?? "",
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
      body: normalizedBody,
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
