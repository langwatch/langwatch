export const DEFAULT_EMBEDDINGS_MODEL = "openai/text-embedding-3-small";

export const OPENAI_EMBEDDING_DIMENSION = 1536;

export const DEFAULT_TOPIC_CLUSTERING_MODEL = "openai/gpt-5.2";

/**
 * Name fragments that mark a field as a credential whatever else is decided
 * about it. A field matching one of these can never be added to
 * `@langwatch/model-provider-contract`'s `PUBLIC_CREDENTIAL_FIELDS`; the
 * classification test enforces that, so an allowlist entry cannot re-expose
 * a secret by mistake.
 */
export const SECRET_CREDENTIAL_MARKERS = [
  "KEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "CREDENTIAL",
] as const;

export const MASKED_KEY_PLACEHOLDER = "HAS_KEY••••••••••••••••••••••••";

/**
 * Hard cap on a single translate-to-English request, enforced by the
 * router's input schema and pre-applied by clients (slice before send).
 * Keeps a multi-MB trace payload from becoming one prompt — context-limit
 * failure or a surprise bill.
 */
export const TRANSLATE_TEXT_MAX_CHARS = 100_000;

export const DEFAULT_MAX_TOKENS = 64_000;

export const MIN_MAX_TOKENS = 256;

export const FALLBACK_MAX_TOKENS = 4096;
