import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  type DataPrivacyConfig,
  type Disposition,
  type PiiLevel,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";

/**
 * Pure form-state to DataPrivacyConfig translation for the privacy-rule drawer.
 *
 * A field only lands in the config when the user explicitly persists it; an
 * omitted field inherits the next scope up. The cascade resolves per field, so
 * a less-restrictive override (e.g. project `capture` over an org `drop`) is
 * only representable by persisting that value EXPLICITLY. The `touched`
 * descriptor names which controls to persist: a touched control is written
 * regardless of value, so `capture` / `essential` / secrets-on become real
 * overrides instead of inherited defaults. Untouched controls stay omitted and
 * keep inheriting.
 */

export type RuleAudience = "admins" | "allMembers" | "noOne";

/**
 * Which drawer controls the user touched, so they persist as explicit overrides.
 * `audience` only surfaces through restrict categories, so it has no standalone
 * field in the built config and is not tracked here.
 */
export interface TouchedControls {
  categories: Partial<Record<ContentCategory, boolean>>;
  pii: boolean;
  secrets: boolean;
}

export function audienceConfig(audience: RuleAudience): {
  admins?: boolean;
  allMembers?: boolean;
} {
  if (audience === "admins") return { admins: true };
  if (audience === "allMembers") return { allMembers: true };
  return {};
}

export function buildRuleConfig({
  dispositions,
  audience,
  piiLevel,
  secretsEnabled,
  touched,
}: {
  dispositions: Record<ContentCategory, Disposition>;
  audience: RuleAudience;
  piiLevel: PiiLevel;
  secretsEnabled: boolean;
  touched: TouchedControls;
}): DataPrivacyConfig {
  const categories: NonNullable<DataPrivacyConfig["categories"]> = {};
  for (const category of CONTENT_CATEGORIES) {
    if (!touched.categories[category]) continue;
    const disposition = dispositions[category];
    if (disposition === "restrict") {
      categories[category] = {
        disposition: "restrict",
        audience: audienceConfig(audience),
      };
    } else {
      categories[category] = { disposition };
    }
  }

  const config: DataPrivacyConfig = {};
  if (Object.keys(categories).length > 0) config.categories = categories;
  if (touched.pii) config.pii = { level: piiLevel };
  if (touched.secrets) config.secrets = { enabled: secretsEnabled };
  return config;
}

/** The drawer's editable form state, independent of which controls are touched. */
export interface RuleFormState {
  dispositions: Record<ContentCategory, Disposition>;
  audience: RuleAudience;
  piiLevel: PiiLevel;
  secretsEnabled: boolean;
}

function audienceFromResolved(
  audience: ResolvedDataPrivacy["categories"][ContentCategory]["audience"],
): RuleAudience {
  if (audience.allMembers) return "allMembers";
  if (audience.admins) return "admins";
  return "noOne";
}

/**
 * The drawer's baseline form state for ADD: the values the new rule would
 * inherit, so the user sees the parent restriction they are overriding. When
 * the selected scope is the current project, that baseline is the resolved
 * effective policy; for any other scope a precise per-scope inherited value
 * isn't readily available, so it falls back to the platform defaults
 * (capture / essential PII / secrets on).
 */
export function inheritedFormState({
  effective,
  isCurrentProjectScope,
}: {
  effective: ResolvedDataPrivacy;
  isCurrentProjectScope: boolean;
}): RuleFormState {
  if (!isCurrentProjectScope) {
    return {
      dispositions: {
        input: "capture",
        output: "capture",
        system: "capture",
        tools: "capture",
      },
      audience: "admins",
      piiLevel: "essential",
      secretsEnabled: true,
    };
  }
  const dispositions: Record<ContentCategory, Disposition> = {
    input: "capture",
    output: "capture",
    system: "capture",
    tools: "capture",
  };
  let audience: RuleAudience = "admins";
  let sawRestrict = false;
  for (const category of CONTENT_CATEGORIES) {
    const resolved = effective.categories[category];
    dispositions[category] = resolved.disposition;
    if (resolved.disposition === "restrict" && !sawRestrict) {
      sawRestrict = true;
      audience = audienceFromResolved(resolved.audience);
    }
  }
  return {
    dispositions,
    audience,
    piiLevel: effective.pii.level,
    secretsEnabled: effective.secrets.enabled,
  };
}

/**
 * Reverse of `buildRuleConfig`: hydrate the drawer's form state from a stored
 * config, for editing an existing rule. Unset categories fall back to the
 * platform default (capture / essential PII / secrets on). The single audience
 * control is seeded from the first restrict category, which is what the drawer
 * applies to every restrict category.
 */
export function configToFormState(config: DataPrivacyConfig): RuleFormState {
  const dispositions: Record<ContentCategory, Disposition> = {
    input: "capture",
    output: "capture",
    system: "capture",
    tools: "capture",
  };
  let audience: RuleAudience = "admins";
  let sawRestrict = false;
  for (const category of CONTENT_CATEGORIES) {
    const setting = config.categories?.[category];
    if (!setting) continue;
    dispositions[category] = setting.disposition;
    if (setting.disposition === "restrict" && !sawRestrict) {
      sawRestrict = true;
      if (setting.audience?.allMembers) audience = "allMembers";
      else if (setting.audience?.admins) audience = "admins";
      else audience = "noOne";
    }
  }
  return {
    dispositions,
    audience,
    piiLevel: config.pii?.level ?? "essential",
    secretsEnabled: config.secrets?.enabled ?? true,
  };
}

/**
 * The controls an existing rule already persists, so editing re-persists them
 * even if the user leaves them untouched. The drawer unions this with the
 * controls the user touched before calling `buildRuleConfig`.
 */
export function touchedFromConfig(config: DataPrivacyConfig): TouchedControls {
  const categories: Partial<Record<ContentCategory, boolean>> = {};
  for (const category of CONTENT_CATEGORIES) {
    if (config.categories?.[category]) categories[category] = true;
  }
  return {
    categories,
    pii: config.pii !== undefined,
    secrets: config.secrets !== undefined,
  };
}

const CATEGORY_SUMMARY_LABELS: Record<ContentCategory, string> = {
  input: "Input",
  output: "Output",
  system: "System instructions",
  tools: "Tool calls",
};

const PII_SUMMARY_LABELS: Record<PiiLevel, string> = {
  disabled: "Disabled",
  essential: "Essential",
  strict: "Strict",
};

const DISPOSITION_SUMMARY_LABELS: Record<Disposition, string> = {
  capture: "captured",
  restrict: "restrict",
  drop: "drop",
};

/**
 * One-line human summary of a rule's config, for the rules table. Every field
 * present in the config is an explicit override (including a `capture` /
 * essential / secrets-on override of a stricter parent), so each one is listed.
 */
export function ruleSummary(config: DataPrivacyConfig): string {
  const parts: string[] = [];
  for (const category of CONTENT_CATEGORIES) {
    const disposition = config.categories?.[category]?.disposition;
    if (disposition) {
      parts.push(
        `${CATEGORY_SUMMARY_LABELS[category]} ${DISPOSITION_SUMMARY_LABELS[disposition]}`,
      );
    }
  }
  if (config.pii) parts.push(`PII ${PII_SUMMARY_LABELS[config.pii.level]}`);
  if (config.secrets) {
    parts.push(config.secrets.enabled ? "Secrets on" : "Secrets off");
  }
  return parts.length > 0 ? parts.join(" · ") : "No changes";
}

/** Whether the built config persists nothing (an untouched form). */
export function isEmptyRuleConfig(config: DataPrivacyConfig): boolean {
  return Object.keys(config).length === 0;
}

/**
 * Order-independent structural equality of two configs, for gating Save on an
 * edit: the button enables only when the built config differs from the rule it
 * is editing.
 */
export function configsEqual(
  a: DataPrivacyConfig,
  b: DataPrivacyConfig,
): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [
            key,
            canonical((value as Record<string, unknown>)[key]),
          ]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
