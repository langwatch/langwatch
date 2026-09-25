/**
 * The OTLP wire vocabulary, shared by the three ingestion paths that read it — before this
 * package, log and metric were byte-identical copies of each other. What belongs here is the
 * WIRE FORMAT all three agree on, not what each path does with the result afterwards.
 */
export {
  otlpAnyValueSchema,
  otlpKeyValueSchema,
  type OtlpAnyValue,
  type OtlpKeyValue,
} from "./any-value.ts";
export { normalizeOtlpAttributeMap, otlpScalarValue } from "./attribute-map.ts";
export { bytesToHex, decodeBase64OpenTelemetryId } from "./id.ts";
export {
  OTLP_MAX_BODY_BYTES,
  otlpProtobufRoot,
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  readOtlpBody,
  decodeOtlpBody,
  type OtlpParseResult,
} from "./body.ts";
export {
  OtlpBodyTooLargeError,
  OtlpBodyUnreadableError,
  OtlpIngestSourceBillingUnavailableError,
  OtlpUnsupportedEncodingError,
} from "./errors.ts";
export {
  applyReceiverProvenance,
  ingestDoorRefusalBody,
  ingestDoorRefusalStatus,
  isIngestDoorRefusal,
  isUnknownCredentialRefusal,
  logCorrectedOtlpPath,
  otlpBodyForensics,
  otlpDoorFailureAnswer,
  type OtlpDoorAnswer,
  type OtlpDoorRefusal,
  type OtlpDoorRequest,
  type OtlpSignal,
  type OtlpSourcePolicy,
} from "./door.ts";
export {
  CANONICAL_OTLP_BASE_PATH,
  canonicalOtlpPath,
  OTLP_CORRECTED_PATH_HEADER,
  readCorrectedPath,
  stampCorrectedPath,
} from "./path-canonicalisation.ts";

export {
  applyOtlpReceiverPolicy,
  otlpReceiverPolicySchema,
  type OtlpReceiverPolicy,
  type OtlpReceiverRequest,
} from "./receiver-policy.ts";
