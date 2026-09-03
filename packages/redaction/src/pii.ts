/**
 * The in-process PII engines, behind their own entry point.
 *
 * `@langwatch/redaction` itself has to stay light enough for a browser bundle
 * — `markers.ts` says so, and the trace-view banner and the data-privacy
 * settings screen both import the root. These modules are the opposite: the
 * recognizer tables, the checksum validators and `libphonenumber-js`. A server
 * that redacts imports them from here; nothing that renders does.
 */

export {
  compilePiiExceptPatterns,
  ESSENTIAL_PII_ENTITIES,
  matchesPiiException,
  type PiiRedactionResult,
  type ProtectedRange,
  redactEssentialPiiInText,
  subtractProtectedRanges,
} from "./essentialPii.js";
export {
  compilePolicyPiiExceptions,
  compilePolicySecretPatterns,
  isIdentifierAttributeName,
  nativePiiEntitiesForPolicy,
  needsStrictAnalysis,
  redactAttributeNative,
  type RedactionPolicy,
  redactStringNative,
} from "./contentRedaction.js";
