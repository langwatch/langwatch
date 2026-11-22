/** Node-only OTLP span decoding, `@langwatch/trace-contract/otlp-decoding`; never the root. */
export { OtlpAttributeFlatteningService } from "./otlp-attribute-flattening.ts";
export { decodeOtlpSpan } from "./otlp-span-decoding.ts";
export {
  convertUnixNanoToUnixMs,
  normalizeOtlpId,
  normalizeOtlpUnixNano,
} from "./otlp-span-identity.ts";
export { OtlpTraceRequestService } from "./otlp-trace-request.ts";
export { deriveRagContextsWithIds, ragDocumentIdFor } from "./span-rag-context-ids.ts";
export { SpanRecordIdentityService } from "./span-record-identity.ts";
