import type {
  DataPrivacyConfig,
  DataPrivacyPiiRedactionLevel,
  PiiLevel,
} from "@langwatch/data-privacy-contract";

const SCOPED_LEVEL: Readonly<Record<DataPrivacyPiiRedactionLevel, PiiLevel>> = {
  STRICT: "strict",
  ESSENTIAL: "essential",
  DISABLED: "disabled",
};

/** The public name of a scoped level; `custom` redacts a chosen entity list, so reads STRICT. */
export function publicPiiRedactionLevel(level: PiiLevel): DataPrivacyPiiRedactionLevel {
  if (level === "disabled") return "DISABLED";
  if (level === "essential") return "ESSENTIAL";

  return "STRICT";
}

/**
 * The rule with its PII level replaced and every other field kept. The entity list
 * belongs to `custom` only, and exception patterns mean nothing when nothing is redacted.
 */
export function withPiiRedactionLevel({
  config,
  level,
}: {
  config: DataPrivacyConfig | undefined;
  level: DataPrivacyPiiRedactionLevel;
}): DataPrivacyConfig {
  const exceptPatterns = config?.pii?.exceptPatterns;
  const keepsExceptions = level !== "DISABLED" && exceptPatterns !== undefined;

  return {
    ...config,
    pii: { level: SCOPED_LEVEL[level], ...(keepsExceptions && { exceptPatterns }) },
  };
}
