import {
  DEFAULT_LOG_COMMAND_SHARDS,
  MAX_LOG_COMMAND_SHARDS,
  MIN_LOG_COMMAND_SHARDS,
  type CanonicalLogRecord,
  type LogPiiRedactionLevel,
  type LogPreparation,
} from "@langwatch/log-contract";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { bodyText, bodyType } from "../rules/canonical-log-correlation.rules.ts";
import {
  canonicalPayloadParts,
  serializeCanonicalPayload,
} from "../rules/canonical-log-payload.rules.ts";
import { collectStringRefs, type StringRef } from "../rules/canonical-log-strings.rules.ts";
import {
  isRecord,
  sha256,
  stableStringify,
  type UnknownRecord,
} from "../rules/canonical-log-value.rules.ts";

export interface LogRedaction {
  redactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      attributeNames?: Record<string, string>;
    },
    piiRedactionLevel: LogPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
}

type PIIRedactionLevel = LogPiiRedactionLevel;
export type LogPreparationInput = {
  tenantId: string;
  organizationId: string;
  request: unknown;
  piiRedactionLevel: LogPiiRedactionLevel;
  acceptedAt?: number;
};
const unknownRecordSchema = z.record(z.string(), z.unknown());
const exportLogsRequestSchema = z
  .object({ resourceLogs: z.array(z.unknown()).optional() })
  .passthrough();

type LogRedactionService = LogRedaction;

type PreparationTally = {
  accepted: PreparedCanonicalLogRecord[];
  errors: string[];
  rejectedLogRecords: number;
};

type PreparationContext = Readonly<{
  args: LogPreparationInput;
  redaction: LogRedaction;
  acceptedAt: number;
}>;

type PreparedCanonicalLogRecord = LogPreparation["accepted"][number];

export class CanonicalLogService {
  private constructor(private readonly redaction: LogRedaction) {}

  static create(options: { redaction: LogRedaction }): CanonicalLogService {
    return new CanonicalLogService(options.redaction);
  }

  prepareCanonicalLogRecords(input: LogPreparationInput): Promise<LogPreparation> {
    return CanonicalLogService.prepareCanonicalLogRecords(input, this.redaction);
  }

  static async prepareCanonicalLogRecords(
    args: LogPreparationInput,
    redaction: LogRedaction,
  ): Promise<LogPreparation> {
    const tally: PreparationTally = { accepted: [], errors: [], rejectedLogRecords: 0 };
    const acceptedAt = args.acceptedAt ?? nowInstant().epochMilliseconds;

    const request = exportLogsRequestSchema.safeParse(args.request);
    for (const resourceLogRaw of request.success ? (request.data.resourceLogs ?? []) : []) {
      const resourceLogParsed = unknownRecordSchema.safeParse(resourceLogRaw);
      if (!resourceLogParsed.success) continue;
      const resourceLog = structuredClone(resourceLogParsed.data);
      const scopeLogs = Array.isArray(resourceLog.scopeLogs) ? resourceLog.scopeLogs : [];
      for (const scopeLogRaw of scopeLogs) {
        const scopeLogParsed = unknownRecordSchema.safeParse(scopeLogRaw);
        if (!scopeLogParsed.success) continue;
        await CanonicalLogService.prepareScopeLog({
          place: { resourceLog, scopeLog: structuredClone(scopeLogParsed.data) },
          context: { args, redaction, acceptedAt },
          tally,
        });
      }
    }
    return {
      accepted: tally.accepted,
      rejectedLogRecords: tally.rejectedLogRecords,
      errors: tally.errors,
    };
  }

  /** Every record of one scope, each prepared against fresh copies of its resource and scope. */
  private static async prepareScopeLog({
    place,
    context,
    tally,
  }: {
    place: Readonly<{ resourceLog: UnknownRecord; scopeLog: UnknownRecord }>;
    context: PreparationContext;
    tally: PreparationTally;
  }): Promise<void> {
    const { resourceLog, scopeLog } = place;
    const resourceTemplate = isRecord(resourceLog.resource) ? resourceLog.resource : {};
    const scopeTemplate = isRecord(scopeLog.scope) ? scopeLog.scope : {};
    const logRecords = Array.isArray(scopeLog.logRecords) ? scopeLog.logRecords : [];
    for (const logRecordRaw of logRecords) {
      if (!isRecord(logRecordRaw)) {
        tally.rejectedLogRecords++;
        tally.errors.push("log record is malformed");
        continue;
      }
      await CanonicalLogService.prepareLogRecord({
        resourceLog: { ...resourceLog, resource: structuredClone(resourceTemplate) },
        scopeLog: { ...scopeLog, scope: structuredClone(scopeTemplate) },
        logRecord: structuredClone(logRecordRaw),
        context,
        tally,
      });
    }
  }

  /** One record redacted and built, or counted as rejected with its reason. */
  private static async prepareLogRecord({
    resourceLog,
    scopeLog,
    logRecord,
    context,
    tally,
  }: {
    resourceLog: UnknownRecord & { resource: UnknownRecord };
    scopeLog: UnknownRecord & { scope: UnknownRecord };
    logRecord: UnknownRecord;
    context: PreparationContext;
    tally: PreparationTally;
  }): Promise<void> {
    const { args, redaction, acceptedAt } = context;
    try {
      await CanonicalLogService.redactTypedLog({
        resourceAttributes: resourceLog.resource.attributes,
        scopeAttributes: scopeLog.scope.attributes,
        logAttributes: logRecord.attributes,
        body: logRecord.body,
        redaction,
        piiRedactionLevel: args.piiRedactionLevel,
        tenantId: args.tenantId,
      });
      tally.accepted.push(
        CanonicalLogService.buildRecord({
          tenantId: args.tenantId,
          organizationId: args.organizationId,
          resourceLog,
          scopeLog,
          logRecord,
          piiRedactionLevel: args.piiRedactionLevel,
          acceptedAt,
        }),
      );
    } catch (error) {
      tally.rejectedLogRecords++;
      tally.errors.push(`log record: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    const lane = BigInt(`0x${sha256(recordId).slice(0, 16)}`) % count;
    return `log:${lane}`;
  }

  private static clampLogCommandShardCount(value: number): number {
    if (!Number.isFinite(value)) return MIN_LOG_COMMAND_SHARDS;
    return Math.min(MAX_LOG_COMMAND_SHARDS, Math.max(MIN_LOG_COMMAND_SHARDS, Math.trunc(value)));
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
    collectStringRefs({
      value: args.resourceAttributes,
      prefix: "resource",
      refs,
    });
    collectStringRefs({ value: args.scopeAttributes, prefix: "scope", refs });
    collectStringRefs({ value: args.logAttributes, prefix: "log", refs });
    collectStringRefs({ value: args.body, prefix: "body", refs });
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

  private static buildRecord(args: {
    tenantId: string;
    organizationId: string;
    resourceLog: UnknownRecord;
    scopeLog: UnknownRecord;
    logRecord: UnknownRecord;
    piiRedactionLevel: PIIRedactionLevel;
    acceptedAt: number;
  }): PreparedCanonicalLogRecord {
    const parts = canonicalPayloadParts({
      resourceLog: args.resourceLog,
      scopeLog: args.scopeLog,
      log: args.logRecord,
      acceptedAt: args.acceptedAt,
    });
    const bodyTextResult = bodyText(parts.canonicalBody);
    const { canonicalPayload, canonicalSizeBytes } = serializeCanonicalPayload(parts.payloadValue);
    const record: CanonicalLogRecord = {
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      recordId: sha256(`${args.tenantId}\0${canonicalPayload}`),
      resourceSchemaUrl: parts.payloadValue.resource.schemaUrl,
      resourceAttributesJson: stableStringify(parts.resourceAttributes),
      resourceAttributesFlatJson: stableStringify(parts.flatResourceAttributes),
      resourceAttributeKeys: [...new Set(parts.resourceAttributes.map((a) => a.key))],
      resourceDroppedAttributesCount: parts.payloadValue.resource.droppedAttributesCount,
      scopeSchemaUrl: parts.payloadValue.scope.schemaUrl,
      scopeName: parts.scopeName,
      scopeVersion: parts.scopeVersion,
      scopeAttributesJson: stableStringify(parts.scopeAttributes),
      scopeAttributeKeys: [...new Set(parts.scopeAttributes.map((a) => a.key))],
      scopeDroppedAttributesCount: parts.payloadValue.scope.droppedAttributesCount,
      wireTraceId: parts.wireTraceId,
      wireSpanId: parts.wireSpanId,
      correlationTraceId: parts.correlation.traceId,
      correlationSpanId: parts.correlation.spanId,
      correlationSource: parts.correlation.source,
      timeUnixNano: parts.timeUnixNano,
      observedTimeUnixNano: parts.observedTimeUnixNano,
      timeUnixMs: parts.occurredAt,
      severityNumber: parts.severityNumber,
      severityText: parts.payloadValue.log.severityText,
      bodyType: bodyType(parts.canonicalBody),
      bodyJson: stableStringify(parts.canonicalBody),
      bodyText: bodyTextResult.present ? bodyTextResult.text : null,
      attributesJson: stableStringify(parts.attributes),
      attributesFlatJson: stableStringify(parts.flatAttributes),
      attributeKeys: [...new Set(parts.attributes.map((a) => a.key))],
      droppedAttributesCount: parts.payloadValue.log.droppedAttributesCount,
      flags: parts.flags,
      eventName: parts.eventName,
      providerKind: parts.correlation.providerKind,
      // Empty since ADR-056 retired log-to-span conversion; agent vocabulary belongs
      // to coding-agent normalization. Migration 00050 keeps the column, but nothing
      // populates or reads it.
      providerEventKind: "",
      providerEventSequence: parts.flatAttributes["event.sequence"] ?? "",
      providerSessionId: parts.flatAttributes["session.id"] ?? "",
      providerConversationId: parts.flatAttributes["conversation.id"] ?? "",
      providerPromptId: parts.flatAttributes["prompt.id"] ?? "",
      piiRedactionLevel: args.piiRedactionLevel,
      canonicalPayload,
      canonicalSizeBytes,
      occurredAt: parts.occurredAt,
      acceptedAt: args.acceptedAt,
    };
    return {
      record,
      normalized: {
        body: bodyTextResult.present ? bodyTextResult.text : stableStringify(parts.canonicalBody),
        attributes: {
          ...parts.flatAttributes,
          ...(parts.eventName && !("event.name" in parts.flatAttributes)
            ? { "event.name": parts.eventName }
            : {}),
        },
        resourceAttributes: parts.flatResourceAttributes,
        scopeName: parts.scopeName,
        scopeVersion: parts.scopeVersion || null,
      },
    };
  }
}
