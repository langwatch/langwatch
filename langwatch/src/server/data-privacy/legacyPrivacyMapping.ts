import {
  dataPrivacyConfigSchema,
  type CategorySetting,
  type DataPrivacyConfig,
  type PiiLevel,
} from "./dataPrivacy.types";

/**
 * Canonical mapping of the legacy privacy controls to the unified
 * DataPrivacyConfig, so a customer keeps their exact posture after the upgrade:
 *   - Organization content mode      -> an organization drop rule
 *   - Project captured-in/out visibility -> a project restrict rule
 *   - Project PII level              -> a project PII level
 * A control already at its default produces no rule; the resolver then returns
 * the platform default for that scope, which equals the old behavior.
 *
 * These are pure functions and are NOT executed at runtime: the actual backfill
 * runs as the SQL migration `20260611120000_backfill_and_drop_legacy_privacy_
 * columns`, which implements this exact mapping before dropping the columns.
 * This module is that migration's tested specification (the
 * specs/data-privacy/privacy-migration.feature scenarios bind to its unit test).
 */

/** Legacy `Organization.governanceLogContentMode` values. */
export type LegacyContentMode = "full" | "strip_io" | "strip_all";
/** Legacy `Project.captured{Input,Output}Visibility` values. */
export type LegacyVisibility =
  | "VISIBLE_TO_ALL"
  | "VISIBLE_TO_ADMIN"
  | "REDACTED_TO_ALL";
/** Legacy `Project.piiRedactionLevel` values. */
export type LegacyPiiLevel = "STRICT" | "ESSENTIAL" | "DISABLED";

const DROP: CategorySetting = { disposition: "drop" };

/** Map an organization's legacy content mode to a drop config (or null = no rule). */
export function mapLegacyContentModeToConfig(
  mode: LegacyContentMode,
): DataPrivacyConfig | null {
  if (mode === "strip_io") {
    return { categories: { input: DROP, output: DROP, system: DROP } };
  }
  if (mode === "strip_all") {
    return {
      categories: { input: DROP, output: DROP, system: DROP, tools: DROP },
    };
  }
  return null;
}

function visibilityToCategory(
  visibility: LegacyVisibility,
): CategorySetting | null {
  switch (visibility) {
    case "VISIBLE_TO_ADMIN":
      return { disposition: "restrict", audience: { admins: true } };
    case "REDACTED_TO_ALL":
      return { disposition: "restrict", audience: {} };
    default:
      // VISIBLE_TO_ALL is the default capture posture — no rule needed.
      return null;
  }
}

function piiToLevel(level: LegacyPiiLevel): PiiLevel | null {
  switch (level) {
    case "STRICT":
      return "strict";
    case "DISABLED":
      return "disabled";
    default:
      // ESSENTIAL is the platform default — no rule needed.
      return null;
  }
}

/** Map a project's legacy visibility + PII settings to a config (or null = no rule). */
export function mapLegacyProjectToConfig(legacy: {
  capturedInputVisibility: LegacyVisibility;
  capturedOutputVisibility: LegacyVisibility;
  piiRedactionLevel: LegacyPiiLevel;
}): DataPrivacyConfig | null {
  const config: DataPrivacyConfig = {};

  const input = visibilityToCategory(legacy.capturedInputVisibility);
  const output = visibilityToCategory(legacy.capturedOutputVisibility);
  if (input || output) {
    config.categories = {};
    if (input) config.categories.input = input;
    if (output) config.categories.output = output;
  }

  const level = piiToLevel(legacy.piiRedactionLevel);
  if (level) config.pii = { level };

  const result = Object.keys(config).length > 0 ? config : null;
  // Validate against the canonical config schema so the mapping can never
  // produce a shape the resolver would reject.
  return result ? dataPrivacyConfigSchema.parse(result) : null;
}
