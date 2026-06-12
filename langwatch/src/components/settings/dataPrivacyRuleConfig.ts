import {
  type Audience,
  CONTENT_CATEGORIES,
  type ContentCategory,
  type CustomAttributeDisposition,
  type DataPrivacyConfig,
  type Disposition,
  type PiiLevel,
  type ResolvedAudience,
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

/**
 * The drawer's audience selection: the built-in role groups, the
 * personal-project owner, plus the organization's custom RBAC groups.
 * Everything off/empty = "no one" (fully hidden).
 */
export interface AudienceFormState {
  admins: boolean;
  allMembers: boolean;
  viewers: boolean;
  projectOwner: boolean;
  groupIds: string[];
}

export const EMPTY_AUDIENCE_FORM: AudienceFormState = {
  admins: false,
  allMembers: false,
  viewers: false,
  projectOwner: false,
  groupIds: [],
};

/** A custom attribute rule row as edited in the drawer. */
export interface CustomAttributeFormRow {
  pattern: string;
  disposition: CustomAttributeDisposition;
}

/**
 * Which drawer controls the user touched, so they persist as explicit overrides.
 * The audience only surfaces through restrict categories/attribute rows, so it
 * has no standalone field in the built config and is not tracked here. Custom
 * attribute rows are explicit by construction (they only exist when added).
 */
export interface TouchedControls {
  categories: Partial<Record<ContentCategory, boolean>>;
  pii: boolean;
  secrets: boolean;
}

export function audienceConfig(audience: AudienceFormState): Audience {
  const out: Audience = {};
  if (audience.admins) out.admins = true;
  if (audience.allMembers) out.allMembers = true;
  if (audience.viewers) out.viewers = true;
  if (audience.projectOwner) out.projectOwner = true;
  if (audience.groupIds.length > 0) out.groupIds = [...audience.groupIds];
  return out;
}

function audienceToFormState(
  audience: Audience | ResolvedAudience | undefined,
): AudienceFormState {
  return {
    admins: audience?.admins ?? false,
    allMembers: audience?.allMembers ?? false,
    viewers: audience?.viewers ?? false,
    projectOwner: audience?.projectOwner ?? false,
    groupIds: [...(audience?.groupIds ?? [])],
  };
}

/** Trimmed, non-empty rows with at least one literal (non-`*`) character. */
export function validCustomAttributeRows(
  rows: CustomAttributeFormRow[],
): CustomAttributeFormRow[] {
  return rows
    .map((row) => ({ ...row, pattern: row.pattern.trim() }))
    .filter(
      (row) =>
        row.pattern.length > 0 && row.pattern.replaceAll("*", "").length > 0,
    );
}

export function buildRuleConfig({
  dispositions,
  audience,
  piiLevel,
  secretsEnabled,
  secretsPatterns,
  customAttributes,
  touched,
}: {
  dispositions: Record<ContentCategory, Disposition>;
  audience: AudienceFormState;
  piiLevel: PiiLevel;
  secretsEnabled: boolean;
  secretsPatterns: string[];
  customAttributes: CustomAttributeFormRow[];
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
  if (touched.secrets) {
    const patterns = secretsPatterns.map((p) => p.trim()).filter(Boolean);
    config.secrets = {
      enabled: secretsEnabled,
      ...(patterns.length > 0 ? { customPatterns: patterns } : {}),
    };
  }
  const attributeRows = validCustomAttributeRows(customAttributes);
  if (attributeRows.length > 0) {
    config.customAttributes = attributeRows.map((row) =>
      row.disposition === "restrict"
        ? {
            pattern: row.pattern,
            disposition: "restrict" as const,
            audience: audienceConfig(audience),
          }
        : { pattern: row.pattern, disposition: "drop" as const },
    );
  }
  return config;
}

/** The drawer's editable form state, independent of which controls are touched. */
export interface RuleFormState {
  dispositions: Record<ContentCategory, Disposition>;
  audience: AudienceFormState;
  piiLevel: PiiLevel;
  secretsEnabled: boolean;
  secretsPatterns: string[];
  customAttributes: CustomAttributeFormRow[];
}

const DEFAULT_DISPOSITIONS: Record<ContentCategory, Disposition> = {
  input: "capture",
  output: "capture",
  system: "capture",
  tools: "capture",
};

/**
 * The drawer's baseline form state for ADD: the values the new rule would
 * inherit, so the user sees the parent restriction they are overriding. When
 * the selected scope is the current project, that baseline is the resolved
 * effective policy; for any other scope a precise per-scope inherited value
 * isn't readily available, so it falls back to the platform defaults
 * (capture / essential PII / secrets on). Custom attribute rules and secret
 * patterns union down the cascade anyway, so they are never prefilled (doing
 * so would duplicate the parent's rows at the child scope).
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
      dispositions: { ...DEFAULT_DISPOSITIONS },
      audience: { ...EMPTY_AUDIENCE_FORM, admins: true },
      piiLevel: "essential",
      secretsEnabled: true,
      secretsPatterns: [],
      customAttributes: [],
    };
  }
  const dispositions: Record<ContentCategory, Disposition> = {
    ...DEFAULT_DISPOSITIONS,
  };
  let audience: AudienceFormState = { ...EMPTY_AUDIENCE_FORM, admins: true };
  let sawRestrict = false;
  for (const category of CONTENT_CATEGORIES) {
    const resolved = effective.categories[category];
    dispositions[category] = resolved.disposition;
    if (resolved.disposition === "restrict" && !sawRestrict) {
      sawRestrict = true;
      audience = audienceToFormState(resolved.audience);
    }
  }
  return {
    dispositions,
    audience,
    piiLevel: effective.pii.level,
    secretsEnabled: effective.secrets.enabled,
    secretsPatterns: [],
    customAttributes: [],
  };
}

/**
 * Reverse of `buildRuleConfig`: hydrate the drawer's form state from a stored
 * config, for editing an existing rule. Unset categories fall back to the
 * platform default (capture / essential PII / secrets on). The single audience
 * control is seeded from the first restrict category or restrict attribute
 * rule, which is what the drawer applies to every restricted item.
 */
export function configToFormState(config: DataPrivacyConfig): RuleFormState {
  const dispositions: Record<ContentCategory, Disposition> = {
    ...DEFAULT_DISPOSITIONS,
  };
  let audience: AudienceFormState = { ...EMPTY_AUDIENCE_FORM, admins: true };
  let sawRestrict = false;
  for (const category of CONTENT_CATEGORIES) {
    const setting = config.categories?.[category];
    if (!setting) continue;
    dispositions[category] = setting.disposition;
    if (setting.disposition === "restrict" && !sawRestrict) {
      sawRestrict = true;
      audience = audienceToFormState(setting.audience);
    }
  }
  for (const rule of config.customAttributes ?? []) {
    if (rule.disposition === "restrict" && !sawRestrict) {
      sawRestrict = true;
      audience = audienceToFormState(rule.audience);
    }
  }
  return {
    dispositions,
    audience,
    piiLevel: config.pii?.level ?? "essential",
    secretsEnabled: config.secrets?.enabled ?? true,
    secretsPatterns: [...(config.secrets?.customPatterns ?? [])],
    customAttributes: (config.customAttributes ?? []).map((rule) => ({
      pattern: rule.pattern,
      disposition: rule.disposition,
    })),
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
  const attributeRules = config.customAttributes?.length ?? 0;
  if (attributeRules > 0) {
    parts.push(
      attributeRules === 1
        ? "1 attribute rule"
        : `${attributeRules} attribute rules`,
    );
  }
  if (config.pii) parts.push(`PII ${PII_SUMMARY_LABELS[config.pii.level]}`);
  if (config.secrets) {
    parts.push(config.secrets.enabled ? "Secrets on" : "Secrets off");
    const patterns = config.secrets.customPatterns?.length ?? 0;
    if (patterns > 0) {
      parts.push(
        patterns === 1 ? "1 secret pattern" : `${patterns} secret patterns`,
      );
    }
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
