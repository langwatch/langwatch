/** Server-side PII engines — too heavy for browser bundles. */

export {
  compilePiiExceptPatterns,
  ESSENTIAL_PII_ENTITIES,
  matchesPiiException,
  type PiiRedactionResult,
  type ProtectedRange,
  redactEssentialPiiInText,
  subtractProtectedRanges,
} from "./essentialPii.ts";
export {
  isHeldOutIdentifierAttribute,
  KNOWN_SPAN_TYPES,
  METADATA_SUBKEY_PREFIXES,
  isOpaqueIdentifierValue,
  isReservedIdentifierAttributeKey,
  reservesModelOrToolName,
  reservesSpanType,
  reservesTraceAddress,
} from "./identifierHoldout.ts";
export {
  compilePolicyPiiExceptions,
  compilePolicySecretPatterns,
  isIdentifierAttributeName,
  nativePiiEntitiesForPolicy,
  needsStrictAnalysis,
  redactAttributeNative,
  type RedactionPolicy,
  redactStringNative,
} from "./contentRedaction.ts";
