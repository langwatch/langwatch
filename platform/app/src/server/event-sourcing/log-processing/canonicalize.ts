import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import type { DeepPartial } from "~/utils/types";
import {
  type CanonicalAnyValue,
  canonicalAnyValue,
  canonicalAttributes,
  flattenAttributes,
} from "./anyValue";
import { normalizeWireId, synthesizeCorrelation } from "./correlation";
import { type LogRedactionService, redactTypedLog } from "./redaction";
import type { CanonicalLogRecord, PIIRedactionLevel } from "./schema";
import {
  integerDecimal,
  isRecord,
  optionalTimestamp,
  sha256,
  stableStringify,
  timestampMs,
  type UnknownRecord,
  uint32Number,
} from "./serialization";

/** The maximum size of one record's canonical payload, before it is rejected. */
export const MAX_CANONICAL_LOG_PAYLOAD_BYTES = 1024 * 1024;

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
  // A record carrying neither timestamp falls back to its acceptance instant:
  // `TimeUnixMs` is in the deployed sort key, so 0 files the row at the epoch
  // where it is past every retention window and unreachable once merged. The
  // fallback is not part of `canonicalPayload`, so `RecordId` is unchanged by
  // it; what two acceptances of one timestamp-less record cost is a sort key
  // that never collapses, and a duplicate row beats a deleted one.
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
  // same id, which is what makes both tables collapse a redelivery on merge.
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
    bodyType: canonicalBody.type,
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
 * Canonicalizes one OTLP `ExportLogsServiceRequest`. An OTLP `partialSuccess`
 * response is a permanent verdict, so a bad record is rejected and counted on
 * its own rather than failing the batch that carried it.
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
