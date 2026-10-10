import {
  MAX_CANONICAL_LOG_PAYLOAD_BYTES,
  type LogCorrelationSource,
  type LogProviderKind,
} from "@langwatch/log-contract";
import { normalizeOtlpAttributeMap } from "@langwatch/otlp";

import {
  effectiveTimestamp,
  normalizeId,
  synthesizeCorrelation,
} from "./canonical-log-correlation.rules.ts";
import {
  canonicalAnyValue,
  canonicalAttributes,
  integerDecimal,
  isRecord,
  optionalTimestamp,
  stableStringify,
  timestampMs,
  uint32Number,
  type UnknownRecord,
} from "./canonical-log-value.rules.ts";

type CanonicalAttributes = { key: string; value: unknown }[];

type CanonicalPayloadParts = {
  payloadValue: {
    resource: {
      schemaUrl: string;
      droppedAttributesCount: number;
      attributes: CanonicalAttributes;
    };
    scope: {
      schemaUrl: string;
      name: string;
      version: string;
      droppedAttributesCount: number;
      attributes: CanonicalAttributes;
    };
    log: { severityText: string; droppedAttributesCount: number } & Record<string, unknown>;
  };
  scopeName: string;
  scopeVersion: string;
  resourceAttributes: CanonicalAttributes;
  scopeAttributes: CanonicalAttributes;
  attributes: CanonicalAttributes;
  flatAttributes: Record<string, string>;
  flatResourceAttributes: Record<string, string>;
  eventName: string;
  wireTraceId: string;
  wireSpanId: string;
  correlation: {
    traceId: string;
    spanId: string;
    source: LogCorrelationSource;
    providerKind: LogProviderKind;
  };
  timeUnixNano: string;
  observedTimeUnixNano: string;
  occurredAt: number;
  flags: number;
  severityNumber: number;
  canonicalBody: unknown;
};

/** The stable payload string and its byte size, refused beyond the contract's maximum. */
export function serializeCanonicalPayload(payloadValue: unknown): {
  canonicalPayload: string;
  canonicalSizeBytes: number;
} {
  const canonicalPayload = stableStringify(payloadValue);
  const canonicalSizeBytes = Buffer.byteLength(canonicalPayload, "utf8");
  if (canonicalSizeBytes > MAX_CANONICAL_LOG_PAYLOAD_BYTES) {
    throw new RangeError(
      `canonical log payload is ${canonicalSizeBytes} bytes (maximum ${MAX_CANONICAL_LOG_PAYLOAD_BYTES})`,
    );
  }
  return { canonicalPayload, canonicalSizeBytes };
}

/** Everything a canonical log record is derived from, read off one decoded OTLP log record. */
export function canonicalPayloadParts(args: {
  resourceLog: UnknownRecord;
  scopeLog: UnknownRecord;
  log: UnknownRecord;
  acceptedAt: number;
}): CanonicalPayloadParts {
  const resource = isRecord(args.resourceLog.resource) ? args.resourceLog.resource : {};
  const scope = isRecord(args.scopeLog.scope) ? args.scopeLog.scope : {};
  const log = args.log;
  const scopeName = typeof scope.name === "string" ? scope.name : "";
  const scopeVersion = typeof scope.version === "string" ? scope.version : "";
  log.attributes = Array.isArray(log.attributes) ? log.attributes : [];

  const resourceAttributes = canonicalAttributes(resource.attributes);
  const scopeAttributes = canonicalAttributes(scope.attributes);
  const attributes = canonicalAttributes(log.attributes);
  const flatAttributes = normalizeOtlpAttributeMap(log.attributes);
  const flatResourceAttributes = normalizeOtlpAttributeMap(resource.attributes);
  const eventName =
    typeof log.eventName === "string" ? log.eventName : (flatAttributes["event.name"] ?? "");
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
  const observedTimeUnixNano = optionalTimestamp(log.observedTimeUnixNano, "observedTimeUnixNano");
  const occurredAt = timestampMs(
    effectiveTimestamp({ timeUnixNano, observedTimeUnixNano, acceptedAt: args.acceptedAt }),
  );
  const flags = uint32Number(log.flags, "flags");
  const severityNumber = Number(integerDecimal(log.severityNumber ?? 0, "severityNumber", 255n));
  const canonicalBody = canonicalAnyValue(log.body);
  const payloadValue = {
    resource: {
      schemaUrl: typeof args.resourceLog.schemaUrl === "string" ? args.resourceLog.schemaUrl : "",
      droppedAttributesCount: uint32Number(
        resource.droppedAttributesCount,
        "resource.droppedAttributesCount",
      ),
      attributes: resourceAttributes,
    },
    scope: {
      schemaUrl: typeof args.scopeLog.schemaUrl === "string" ? args.scopeLog.schemaUrl : "",
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
      severityText: typeof log.severityText === "string" ? log.severityText : "",
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
  return {
    payloadValue,
    scopeName,
    scopeVersion,
    resourceAttributes,
    scopeAttributes,
    attributes,
    flatAttributes,
    flatResourceAttributes,
    eventName,
    wireTraceId,
    wireSpanId,
    correlation,
    timeUnixNano,
    observedTimeUnixNano,
    occurredAt,
    flags,
    severityNumber,
    canonicalBody,
  };
}
