import { createHash } from "node:crypto";

import { compareOrdinal } from "@langwatch/eventing";
import {
  DEFAULT_LOG_COMMAND_SHARDS,
  MAX_CANONICAL_LOG_PAYLOAD_BYTES,
  MAX_LOG_COMMAND_SHARDS,
  MIN_LOG_COMMAND_SHARDS,
  type CanonicalLogRecord,
  type LogCorrelationSource,
  type LogPiiRedactionLevel,
  type LogPreparation,
  type LogProviderKind,
} from "@langwatch/log-contract";
import { normalizeOtlpAttributeMap } from "@langwatch/otlp";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import {
  type LogPreparer,
  type LogPreparationInput,
  type LogRedaction,
} from "../app/log.members.ts";

type UnknownRecord = Record<string, unknown>;
type PIIRedactionLevel = LogPiiRedactionLevel;
type CanonicalLogPreparationInput = LogPreparationInput;
const unknownRecordSchema = z.record(z.string(), z.unknown());
const exportLogsRequestSchema = z
  .object({ resourceLogs: z.array(z.unknown()).optional() })
  .passthrough();
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";
const CODEX_EVENT_NAME_PREFIX = "codex.";

type LogRedactionService = LogRedaction;

type PreparedCanonicalLogRecord = LogPreparation["accepted"][number];

type StringRef = {
  owner: UnknownRecord;
  key: string;
  path: string;
  /** The OTLP attribute this string belongs to, when it sits under one. */
  attributeName?: string;
};

/**
 * Walk decoded OTLP tree, collect stringValue leaves with array-indexed paths (for
 * uniqueness) and carry the owning attribute name so redaction NAME rules can fire.
 */
export class CanonicalLogService implements LogPreparer {
  private constructor(private readonly redaction: LogRedaction) {}

  static create(options: { redaction: LogRedaction }): CanonicalLogService {
    return new CanonicalLogService(options.redaction);
  }

  prepare(input: LogPreparationInput): Promise<LogPreparation> {
    return CanonicalLogService.prepareCanonicalLogRecords(input, this.redaction);
  }

  static async prepareCanonicalLogRecords(
    args: CanonicalLogPreparationInput,
    redaction: LogRedaction,
  ): Promise<LogPreparation> {
    const accepted: PreparedCanonicalLogRecord[] = [];
    const errors: string[] = [];
    let rejectedLogRecords = 0;
    const acceptedAt = args.acceptedAt ?? nowInstant().epochMilliseconds;

    const request = exportLogsRequestSchema.safeParse(args.request);
    for (const resourceLogRaw of request.success ? (request.data.resourceLogs ?? []) : []) {
      const resourceLogParsed = unknownRecordSchema.safeParse(resourceLogRaw);
      if (!resourceLogParsed.success) continue;
      const resourceLog = structuredClone(resourceLogParsed.data);
      const resourceTemplate = CanonicalLogService.isRecord(resourceLog.resource)
        ? resourceLog.resource
        : {};
      const scopeLogs = Array.isArray(resourceLog.scopeLogs) ? resourceLog.scopeLogs : [];
      for (const scopeLogRaw of scopeLogs) {
        const scopeLogParsed = unknownRecordSchema.safeParse(scopeLogRaw);
        if (!scopeLogParsed.success) continue;
        const scopeLog = structuredClone(scopeLogParsed.data);
        const scopeTemplate = CanonicalLogService.isRecord(scopeLog.scope) ? scopeLog.scope : {};
        const logRecords = Array.isArray(scopeLog.logRecords) ? scopeLog.logRecords : [];
        for (const logRecordRaw of logRecords) {
          if (!CanonicalLogService.isRecord(logRecordRaw)) {
            rejectedLogRecords++;
            errors.push("log record is malformed");
            continue;
          }
          const resource = structuredClone(resourceTemplate);
          const scope = structuredClone(scopeTemplate);
          const logRecord = structuredClone(logRecordRaw);
          try {
            await CanonicalLogService.redactTypedLog({
              resourceAttributes: resource.attributes,
              scopeAttributes: scope.attributes,
              logAttributes: logRecord.attributes,
              body: logRecord.body,
              redaction,
              piiRedactionLevel: args.piiRedactionLevel,
              tenantId: args.tenantId,
            });
            accepted.push(
              CanonicalLogService.buildRecord({
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
            errors.push(`log record: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    return { accepted, rejectedLogRecords, errors };
  }

  static resolveLogCommandShardCount(value: string | undefined): number {
    if (!value) return DEFAULT_LOG_COMMAND_SHARDS;
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? CanonicalLogService.clampLogCommandShardCount(parsed)
      : DEFAULT_LOG_COMMAND_SHARDS;
  }

  static logCommandGroupKey(recordId: string, shardCount: number): string {
    const count = BigInt(CanonicalLogService.clampLogCommandShardCount(shardCount));
    const lane = BigInt(`0x${CanonicalLogService.sha256(recordId).slice(0, 16)}`) % count;
    return `log:${lane}`;
  }

  private static clampLogCommandShardCount(value: number): number {
    if (!Number.isFinite(value)) return MIN_LOG_COMMAND_SHARDS;
    return Math.min(MAX_LOG_COMMAND_SHARDS, Math.max(MIN_LOG_COMMAND_SHARDS, Math.trunc(value)));
  }

  /**
   * Do not use serialization.isRecord: it accepts arrays, but OTLP arrayValue and
   * kvlistValue must canonicalize separately or their RecordIds change.
   */
  private static isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  private static longBitsToBigInt(value: UnknownRecord): bigint {
    const low = BigInt(Number(value.low ?? 0) >>> 0);
    const high = BigInt(Number(value.high ?? 0) >>> 0);
    return BigInt.asUintN(64, (high << 32n) | low);
  }

  private static integerDecimal(value: unknown, label: string, max: bigint): string {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${label} is not a safely represented unsigned integer`);
    }
    let decimal: string;
    if (typeof value === "bigint") decimal = value.toString();
    else if (typeof value === "string") decimal = value;
    else if (typeof value === "number") decimal = String(value);
    else if (CanonicalLogService.isRecord(value) && "low" in value && "high" in value) {
      decimal = CanonicalLogService.longBitsToBigInt(value).toString();
    } else {
      throw new Error(`${label} is not an integer`);
    }
    if (!/^\d+$/.test(decimal)) throw new Error(`${label} is not an integer`);
    const parsed = BigInt(decimal);
    if (parsed > max) throw new Error(`${label} is outside its OTLP range`);
    return parsed.toString();
  }

  private static optionalTimestamp(value: unknown, label: string): string {
    if (value === undefined || value === null) return "0";
    return CanonicalLogService.integerDecimal(value, label, MAX_UINT64);
  }

  private static uint32Number(value: unknown, label: string): number {
    return Number(CanonicalLogService.integerDecimal(value ?? 0, label, MAX_UINT32));
  }

  private static timestampMs(timestamp: string): number {
    const ms = Number(BigInt(timestamp) / 1_000_000n);
    if (!Number.isSafeInteger(ms) || ms < 0) {
      throw new Error(`OTLP timestamp is outside the supported range: ${timestamp}`);
    }
    return ms;
  }

  private static canonicalAnyValue(value: unknown): unknown {
    if (!CanonicalLogService.isRecord(value)) return { type: "empty" };
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
    if (present.length > 1) throw new Error("OTLP AnyValue contains multiple values");
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
      if (CanonicalLogService.isRecord(raw) && "low" in raw && "high" in raw) {
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
        const roundTrip = Buffer.from(raw, "base64").toString("base64").replace(/=+$/, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || roundTrip !== unpadded) {
          throw new Error("bytesValue is not valid base64");
        }
      }
      let bytes: Uint8Array | Buffer | null;
      if (raw instanceof Uint8Array) {
        bytes = raw;
      } else if (typeof raw === "string") {
        bytes = Buffer.from(raw, "base64");
      } else if (CanonicalLogService.isRecord(raw)) {
        bytes = Buffer.from(
          Object.entries(raw)
            .toSorted(([left], [right]) => Number(left) - Number(right))
            .map(([, byte]) => Number(byte)),
        );
      } else {
        bytes = null;
      }
      if (!bytes) throw new Error("bytesValue is malformed");
      return { type: "bytes", value: Buffer.from(bytes).toString("base64") };
    }
    if (kind === "arrayValue") {
      const array = value.arrayValue;
      if (!CanonicalLogService.isRecord(array) || !Array.isArray(array.values)) {
        throw new Error("arrayValue is malformed");
      }
      return {
        type: "array",
        value: array.values.map((item) => CanonicalLogService.canonicalAnyValue(item)),
      };
    }
    const list = value.kvlistValue;
    if (!CanonicalLogService.isRecord(list) || !Array.isArray(list.values)) {
      throw new Error("kvlistValue is malformed");
    }
    return { type: "kvlist", value: CanonicalLogService.canonicalAttributes(list.values) };
  }

  private static canonicalAttributes(attributes: unknown): { key: string; value: unknown }[] {
    if (!Array.isArray(attributes)) return [];
    return attributes
      .map((raw) => {
        if (!CanonicalLogService.isRecord(raw) || typeof raw.key !== "string") {
          throw new Error("attribute is malformed");
        }
        return { key: raw.key, value: CanonicalLogService.canonicalAnyValue(raw.value) };
      })
      .toSorted((left, right) => {
        const byKey = compareOrdinal(left.key, right.key);
        return (
          byKey ||
          compareOrdinal(
            CanonicalLogService.stableStringify(left.value),
            CanonicalLogService.stableStringify(right.value),
          )
        );
      });
  }

  /** The attribute an OTLP KeyValue node names, when this node is one. */
  private static otlpAttributeName(value: UnknownRecord): string | undefined {
    return typeof value.key === "string" && "value" in value ? value.key : undefined;
  }

  private static collectStringRefs({
    value,
    prefix,
    refs,
    attributeName,
  }: {
    value: unknown;
    prefix: string;
    refs: StringRef[];
    attributeName?: string;
  }) {
    if (Array.isArray(value)) {
      value.forEach((child, index) =>
        CanonicalLogService.collectStringRefs({
          value: child,
          prefix: `${prefix}.${index}`,
          refs,
          attributeName,
        }),
      );
      return;
    }
    if (!CanonicalLogService.isRecord(value)) return;
    const ownName = CanonicalLogService.otlpAttributeName(value) ?? attributeName;
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (key === "stringValue" && typeof child === "string") {
        refs.push({ owner: value, key, path, attributeName });
      } else {
        CanonicalLogService.collectStringRefs({
          value: child,
          prefix: path,
          refs,
          attributeName: ownName,
        });
      }
    }
  }

  private static async redactTypedLog(args: {
    resourceAttributes: unknown;
    scopeAttributes: unknown;
    logAttributes: unknown;
    body: unknown;
    redaction: LogRedactionService;
    piiRedactionLevel: PIIRedactionLevel;
    tenantId: string;
  }) {
    const refs: StringRef[] = [];
    CanonicalLogService.collectStringRefs({
      value: args.resourceAttributes,
      prefix: "resource",
      refs,
    });
    CanonicalLogService.collectStringRefs({ value: args.scopeAttributes, prefix: "scope", refs });
    CanonicalLogService.collectStringRefs({ value: args.logAttributes, prefix: "log", refs });
    CanonicalLogService.collectStringRefs({ value: args.body, prefix: "body", refs });
    const attributes = Object.fromEntries(
      refs.map((ref) => [ref.path, String(ref.owner[ref.key])]),
    );
    const attributeNames = Object.fromEntries(
      refs.flatMap((ref) =>
        ref.attributeName === undefined ? [] : [[ref.path, ref.attributeName]],
      ),
    );
    await args.redaction.redactLog(
      { body: "", attributes, resourceAttributes: {}, attributeNames },
      args.piiRedactionLevel,
      args.tenantId,
    );
    for (const ref of refs) {
      const redacted = attributes[ref.path];
      if (redacted !== undefined) ref.owner[ref.key] = redacted;
    }
  }

  private static normalizeId(value: unknown): string {
    if (value === undefined || value === null) return "";
    const normalized = value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value;
    return typeof normalized === "string" ? normalized.toLowerCase() : "";
  }

  private static validTraceId(value: string): boolean {
    return /^[a-f0-9]{32}$/.test(value) && !/^0+$/.test(value);
  }

  private static validSpanId(value: string): boolean {
    return /^[a-f0-9]{16}$/.test(value) && !/^0+$/.test(value);
  }

  private static synthesizeCorrelation(args: {
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
    let providerKind: LogProviderKind;
    if (args.scopeName === CLAUDE_CODE_EVENT_SCOPE) {
      providerKind = "claude_code";
    } else if (eventName.startsWith(CODEX_EVENT_NAME_PREFIX)) {
      providerKind = "codex";
    } else {
      providerKind = "generic";
    }
    if (
      CanonicalLogService.validTraceId(wireTraceId) &&
      CanonicalLogService.validSpanId(wireSpanId)
    ) {
      return {
        traceId: wireTraceId,
        spanId: wireSpanId,
        source: "wire",
        providerKind,
      };
    }
    const sessionId = attributes["session.id"] ?? "";
    if (providerKind === "claude_code" && sessionId) {
      return CanonicalLogService.claudeSynthesizedCorrelation({
        sessionId,
        wireTraceId,
        wireSpanId,
        eventName,
        attributes,
      });
    }
    const conversationId = attributes["conversation.id"] ?? "";
    if (providerKind === "codex" && conversationId) {
      return CanonicalLogService.codexSynthesizedCorrelation({
        conversationId,
        wireTraceId,
        wireSpanId,
        eventName,
        attributes,
      });
    }
    return { traceId: "", spanId: "", source: "none", providerKind };
  }

  private static claudeSynthesizedCorrelation(args: {
    sessionId: string;
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
    const { sessionId, wireTraceId, wireSpanId, eventName, attributes } = args;
    const promptId = attributes["prompt.id"] ?? "";
    const turnKey = promptId ? `${sessionId}:${promptId}` : sessionId;
    const traceId = CanonicalLogService.validTraceId(wireTraceId)
      ? wireTraceId
      : CanonicalLogService.sha256(turnKey).slice(0, 32);
    const spanId = CanonicalLogService.validSpanId(wireSpanId)
      ? wireSpanId
      : CanonicalLogService.sha256(
          `${sessionId}:${promptId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
        ).slice(0, 16);
    return {
      traceId,
      spanId,
      source: "claude_synthesized",
      providerKind: "claude_code",
    };
  }

  private static codexSynthesizedCorrelation(args: {
    conversationId: string;
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
    const { conversationId, wireTraceId, wireSpanId, eventName, attributes } = args;
    const traceId = CanonicalLogService.validTraceId(wireTraceId)
      ? wireTraceId
      : CanonicalLogService.sha256(conversationId).slice(0, 32);
    const spanId = CanonicalLogService.validSpanId(wireSpanId)
      ? wireSpanId
      : CanonicalLogService.sha256(
          `${conversationId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
        ).slice(0, 16);
    return {
      traceId,
      spanId,
      source: "codex_synthesized",
      providerKind: "codex",
    };
  }

  private static bodyType(body: unknown): CanonicalLogRecord["bodyType"] {
    if (!CanonicalLogService.isRecord(body)) return "empty";
    const parsed = z
      .enum(["empty", "string", "bool", "int", "double", "bytes", "array", "kvlist"])
      .safeParse(body.type);
    return parsed.success ? parsed.data : "empty";
  }

  private static bodyText(body: unknown): string | null {
    if (!CanonicalLogService.isRecord(body)) return null;
    if (body.type === "string" && typeof body.value === "string") {
      return body.value;
    }
    return null;
  }

  private static effectiveTimestamp({
    timeUnixNano,
    observedTimeUnixNano,
    acceptedAt,
  }: {
    timeUnixNano: string;
    observedTimeUnixNano: string;
    acceptedAt: number;
  }): string {
    if (timeUnixNano !== "0") return timeUnixNano;
    if (observedTimeUnixNano !== "0") return observedTimeUnixNano;
    return String(BigInt(acceptedAt) * 1_000_000n);
  }

  private static buildRecord(args: {
    tenantId: string;
    organizationId: string;
    resourceLog: UnknownRecord;
    scopeLog: UnknownRecord;
    logRecord: UnknownRecord;
    piiRedactionLevel: PIIRedactionLevel;
    acceptedAt: number;
  }): PreparedCanonicalLogRecord {
    const resource = CanonicalLogService.isRecord(args.resourceLog.resource)
      ? args.resourceLog.resource
      : {};
    const scope = CanonicalLogService.isRecord(args.scopeLog.scope) ? args.scopeLog.scope : {};
    const log = args.logRecord;
    const scopeName = typeof scope.name === "string" ? scope.name : "";
    const scopeVersion = typeof scope.version === "string" ? scope.version : "";
    const logAttributes = Array.isArray(log.attributes) ? log.attributes : [];
    log.attributes = logAttributes;

    const resourceAttributes = CanonicalLogService.canonicalAttributes(resource.attributes);
    const scopeAttributes = CanonicalLogService.canonicalAttributes(scope.attributes);
    const attributes = CanonicalLogService.canonicalAttributes(log.attributes);
    const flatAttributes = normalizeOtlpAttributeMap(log.attributes);
    const eventName =
      typeof log.eventName === "string" ? log.eventName : (flatAttributes["event.name"] ?? "");
    const flatResourceAttributes = normalizeOtlpAttributeMap(resource.attributes);
    const wireTraceId = CanonicalLogService.normalizeId(log.traceId);
    const wireSpanId = CanonicalLogService.normalizeId(log.spanId);
    const correlation = CanonicalLogService.synthesizeCorrelation({
      scopeName,
      wireTraceId,
      wireSpanId,
      eventName,
      attributes: flatAttributes,
    });
    const timeUnixNano = CanonicalLogService.optionalTimestamp(log.timeUnixNano, "timeUnixNano");
    const observedTimeUnixNano = CanonicalLogService.optionalTimestamp(
      log.observedTimeUnixNano,
      "observedTimeUnixNano",
    );
    const effectiveTimestamp = CanonicalLogService.effectiveTimestamp({
      timeUnixNano,
      observedTimeUnixNano,
      acceptedAt: args.acceptedAt,
    });
    const flags = CanonicalLogService.uint32Number(log.flags, "flags");
    const severityNumber = Number(
      CanonicalLogService.integerDecimal(log.severityNumber ?? 0, "severityNumber", 255n),
    );
    const canonicalBody = CanonicalLogService.canonicalAnyValue(log.body);
    const canonicalPayloadValue = {
      resource: {
        schemaUrl: typeof args.resourceLog.schemaUrl === "string" ? args.resourceLog.schemaUrl : "",
        droppedAttributesCount: CanonicalLogService.uint32Number(
          resource.droppedAttributesCount,
          "resource.droppedAttributesCount",
        ),
        attributes: resourceAttributes,
      },
      scope: {
        schemaUrl: typeof args.scopeLog.schemaUrl === "string" ? args.scopeLog.schemaUrl : "",
        name: scopeName,
        version: scopeVersion,
        droppedAttributesCount: CanonicalLogService.uint32Number(
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
        severityText: typeof log.severityText === "string" ? log.severityText : "",
        body: canonicalBody,
        attributes,
        droppedAttributesCount: CanonicalLogService.uint32Number(
          log.droppedAttributesCount,
          "log.droppedAttributesCount",
        ),
        flags,
        eventName,
      },
    };
    const canonicalPayload = CanonicalLogService.stableStringify(canonicalPayloadValue);
    const canonicalSizeBytes = Buffer.byteLength(canonicalPayload, "utf8");
    if (canonicalSizeBytes > MAX_CANONICAL_LOG_PAYLOAD_BYTES) {
      throw new RangeError(
        `canonical log payload is ${canonicalSizeBytes} bytes (maximum ${MAX_CANONICAL_LOG_PAYLOAD_BYTES})`,
      );
    }
    const recordId = CanonicalLogService.sha256(`${args.tenantId}\0${canonicalPayload}`);
    const normalizedBody =
      CanonicalLogService.bodyText(canonicalBody) ??
      CanonicalLogService.stableStringify(canonicalBody);
    const record: CanonicalLogRecord = {
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      recordId,
      resourceSchemaUrl: canonicalPayloadValue.resource.schemaUrl,
      resourceAttributesJson: CanonicalLogService.stableStringify(resourceAttributes),
      resourceAttributesFlatJson: CanonicalLogService.stableStringify(flatResourceAttributes),
      resourceAttributeKeys: [...new Set(resourceAttributes.map((a) => a.key))],
      resourceDroppedAttributesCount: canonicalPayloadValue.resource.droppedAttributesCount,
      scopeSchemaUrl: canonicalPayloadValue.scope.schemaUrl,
      scopeName,
      scopeVersion,
      scopeAttributesJson: CanonicalLogService.stableStringify(scopeAttributes),
      scopeAttributeKeys: [...new Set(scopeAttributes.map((a) => a.key))],
      scopeDroppedAttributesCount: canonicalPayloadValue.scope.droppedAttributesCount,
      wireTraceId,
      wireSpanId,
      correlationTraceId: correlation.traceId,
      correlationSpanId: correlation.spanId,
      correlationSource: correlation.source,
      timeUnixNano,
      observedTimeUnixNano,
      timeUnixMs: CanonicalLogService.timestampMs(effectiveTimestamp),
      severityNumber,
      severityText: canonicalPayloadValue.log.severityText,
      bodyType: CanonicalLogService.bodyType(canonicalBody),
      bodyJson: CanonicalLogService.stableStringify(canonicalBody),
      bodyText: CanonicalLogService.bodyText(canonicalBody),
      attributesJson: CanonicalLogService.stableStringify(attributes),
      attributesFlatJson: CanonicalLogService.stableStringify(flatAttributes),
      attributeKeys: [...new Set(attributes.map((a) => a.key))],
      droppedAttributesCount: canonicalPayloadValue.log.droppedAttributesCount,
      flags,
      eventName,
      providerKind: correlation.providerKind,
      // Empty since ADR-056 retired log-to-span conversion; agent vocabulary belongs
      // to coding-agent normalization. Migration 00050 keeps the column, but nothing
      // populates or reads it.
      providerEventKind: "",
      providerEventSequence: flatAttributes["event.sequence"] ?? "",
      providerSessionId: flatAttributes["session.id"] ?? "",
      providerConversationId: flatAttributes["conversation.id"] ?? "",
      providerPromptId: flatAttributes["prompt.id"] ?? "",
      piiRedactionLevel: args.piiRedactionLevel,
      canonicalPayload,
      canonicalSizeBytes,
      occurredAt: CanonicalLogService.timestampMs(effectiveTimestamp),
      acceptedAt: args.acceptedAt,
    };
    return {
      record,
      normalized: {
        body: normalizedBody,
        attributes: {
          ...flatAttributes,
          ...(eventName && !("event.name" in flatAttributes) ? { "event.name": eventName } : {}),
        },
        resourceAttributes: flatResourceAttributes,
        scopeName,
        scopeVersion: scopeVersion || null,
      },
    };
  }

  private static isSerializableRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === "object";
  }

  /** Deterministic JSON: object keys sort; array order remains meaningful. */
  private static stableStringify(value: unknown): string {
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
      if (CanonicalLogService.isSerializableRecord(current)) {
        return CanonicalLogService.normalizeRecord({ current, normalize, seen });
      }
      return current;
    };
    return JSON.stringify(normalize(value));
  }

  private static normalizeRecord({
    current,
    normalize,
    seen,
  }: {
    current: UnknownRecord;
    normalize: (value: unknown) => unknown;
    seen: WeakSet<object>;
  }): UnknownRecord {
    if (seen.has(current)) throw new Error("Cannot canonicalize cyclic OTLP data");
    seen.add(current);
    const result: UnknownRecord = {};
    for (const key of Object.keys(current).toSorted()) {
      result[key] = normalize(current[key]);
    }
    seen.delete(current);
    return result;
  }

  private static sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
