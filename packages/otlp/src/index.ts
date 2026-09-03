/**
 * The OTLP wire vocabulary, shared by the three ingestion paths that read it.
 *
 * `log`, `metric` and `trace` each accept OTLP and each have to answer the same
 * questions about it: which of an `AnyValue`'s fields is set, what a nested
 * attribute is called once flattened, and whether an identifier arrived as
 * bytes, base64 or hex. Before this package the log and metric answers were
 * byte-identical copies of one another, and the trace package exported a third
 * implementation under the same name that nothing imported.
 *
 * What belongs here is what all three must agree on because it is the WIRE
 * FORMAT — not what any one of them does with the result. The canonicalisation
 * each path performs afterwards stays in that path: log's is strict and throws
 * on a malformed value, metric's is lenient and substitutes an empty one, and
 * that difference is deliberate.
 */
export {
  otlpAnyValueSchema,
  otlpKeyValueSchema,
  type OtlpAnyValue,
  type OtlpKeyValue,
} from "./any-value";
export { normalizeOtlpAttributeMap, otlpScalarValue } from "./attribute-map";
export { bytesToHex, decodeBase64OpenTelemetryId } from "./id";
export {
  OTLP_MAX_BODY_BYTES,
  otlpProtobufRoot,
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  readOtlpBody,
  type OtlpParseResult,
} from "./body";
export {
  OtlpBodyTooLargeError,
  OtlpBodyUnreadableError,
  OtlpUnsupportedEncodingError,
} from "./errors";
export {
  CANONICAL_OTLP_BASE_PATH,
  canonicalOtlpPath,
  OTLP_CORRECTED_PATH_HEADER,
  readCorrectedPath,
  stampCorrectedPath,
} from "./path-canonicalisation";
