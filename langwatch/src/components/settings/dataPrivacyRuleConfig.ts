import {
  type Audience,
  CONTENT_CATEGORIES,
  type ContentCategory,
  type CustomAttributeDisposition,
  type DataPrivacyConfig,
  type Disposition,
  type PiiLevel,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedAudience,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";

/**
 * Pure form-state to DataPrivacyConfig translation for the privacy-rule drawer.
 *
 * Every control carries an explicit "inherit" choice on top of its real values.
 * A field only lands in the config when its control names a concrete value; an
 * "inherit" control is omitted, so that field falls through to the next scope up
 * the cascade (and finally the platform default). The cascade resolves per
 * field, so a less-restrictive override (e.g. project `capture` over an org
 * `drop`) is representable by choosing that value explicitly, while "inherit"
 * hands the field back to the wider scope.
 */

/** The four content categories plus the explicit "inherit from parent" choice. */
export type CategoryChoice = "inherit" | Disposition;
/** The PII levels plus the explicit "inherit from parent" choice. */
export type PiiChoice = "inherit" | PiiLevel;
/** Secrets redaction as a tri-state: inherit, explicitly on, explicitly off. */
export type SecretsChoice = "inherit" | "on" | "off";

/**
 * The drawer's audience selection: everyone with access (all members), the
 * standard role groups (admins, members, viewers), the personal-project
 * owners, plus the organization's custom RBAC groups. Everything off/empty =
 * "no one" (fully hidden).
 */
export interface AudienceFormState {
  admins: boolean;
  allMembers: boolean;
  members: boolean;
  viewers: boolean;
  projectOwner: boolean;
  groupIds: string[];
}

export const EMPTY_AUDIENCE_FORM: AudienceFormState = {
  admins: false,
  allMembers: false,
  members: false,
  viewers: false,
  projectOwner: false,
  groupIds: [],
};

/**
 * The audience as picker values, one entry per selected group:
 * `allMembers`, `projectOwner`, `role:admins|members|viewers`, `group:<id>`.
 */
export const ALL_MEMBERS_VALUE = "allMembers";
export const PROJECT_OWNER_VALUE = "projectOwner";
export const ROLE_VALUES = {
  admins: "role:admins",
  members: "role:members",
  viewers: "role:viewers",
} as const;

export function audienceToSelection(audience: AudienceFormState): string[] {
  const values: string[] = [];
  if (audience.allMembers) values.push(ALL_MEMBERS_VALUE);
  if (audience.projectOwner) values.push(PROJECT_OWNER_VALUE);
  if (audience.admins) values.push(ROLE_VALUES.admins);
  if (audience.members) values.push(ROLE_VALUES.members);
  if (audience.viewers) values.push(ROLE_VALUES.viewers);
  for (const id of audience.groupIds) values.push(`group:${id}`);
  return values;
}

export function selectionToAudience(values: string[]): AudienceFormState {
  return {
    allMembers: values.includes(ALL_MEMBERS_VALUE),
    projectOwner: values.includes(PROJECT_OWNER_VALUE),
    admins: values.includes(ROLE_VALUES.admins),
    members: values.includes(ROLE_VALUES.members),
    viewers: values.includes(ROLE_VALUES.viewers),
    groupIds: values
      .filter((v) => v.startsWith("group:"))
      .map((v) => v.slice("group:".length)),
  };
}

/**
 * Collapse rule for the audience picker: "All members" already covers every
 * other group, so picking it replaces the whole selection, and picking
 * anything narrower drops it.
 */
export function applyAudienceSelection(
  previous: string[],
  next: string[],
): string[] {
  const pickedAllMembers =
    next.includes(ALL_MEMBERS_VALUE) && !previous.includes(ALL_MEMBERS_VALUE);
  if (pickedAllMembers) return [ALL_MEMBERS_VALUE];
  const addedNarrower = next.some(
    (v) => v !== ALL_MEMBERS_VALUE && !previous.includes(v),
  );
  if (addedNarrower) return next.filter((v) => v !== ALL_MEMBERS_VALUE);
  return next;
}

/** A custom attribute rule row as edited in the drawer. */
export interface CustomAttributeFormRow {
  pattern: string;
  disposition: CustomAttributeDisposition;
}

export function audienceConfig(audience: AudienceFormState): Audience {
  const out: Audience = {};
  if (audience.admins) out.admins = true;
  if (audience.allMembers) out.allMembers = true;
  if (audience.members) out.members = true;
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
    members: audience?.members ?? false,
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
  piiChoice,
  piiEntities,
  secretsChoice,
  secretsPatterns,
  customAttributes,
}: {
  dispositions: Record<ContentCategory, CategoryChoice>;
  audience: AudienceFormState;
  piiChoice: PiiChoice;
  piiEntities: string[];
  secretsChoice: SecretsChoice;
  secretsPatterns: string[];
  customAttributes: CustomAttributeFormRow[];
}): DataPrivacyConfig {
  const categories: NonNullable<DataPrivacyConfig["categories"]> = {};
  for (const category of CONTENT_CATEGORIES) {
    const choice = dispositions[category];
    if (choice === "inherit") continue;
    if (choice === "restrict") {
      categories[category] = {
        disposition: "restrict",
        audience: audienceConfig(audience),
      };
    } else {
      categories[category] = { disposition: choice };
    }
  }

  const config: DataPrivacyConfig = {};
  if (Object.keys(categories).length > 0) config.categories = categories;
  if (piiChoice !== "inherit") {
    config.pii =
      piiChoice === "custom"
        ? { level: piiChoice, entities: [...piiEntities].sort() }
        : { level: piiChoice };
  }
  if (secretsChoice !== "inherit") {
    const patterns = secretsPatterns.map((p) => p.trim()).filter(Boolean);
    config.secrets = {
      enabled: secretsChoice === "on",
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

/** The drawer's editable form state. Every control can resolve to "inherit". */
export interface RuleFormState {
  dispositions: Record<ContentCategory, CategoryChoice>;
  audience: AudienceFormState;
  piiChoice: PiiChoice;
  /** Selected entity names, only meaningful when piiChoice === "custom". */
  piiEntities: string[];
  secretsChoice: SecretsChoice;
  secretsPatterns: string[];
  customAttributes: CustomAttributeFormRow[];
}

const INHERIT_DISPOSITIONS: Record<ContentCategory, CategoryChoice> = {
  input: "inherit",
  output: "inherit",
  system: "inherit",
  tools: "inherit",
};

/**
 * A blank rule: every control inherits, so a saved-as-is rule changes nothing.
 * The drawer surfaces what each field resolves to next to the "Inherit" choice,
 * so the admin sees the inherited posture before overriding any field.
 */
export function inheritFormState(): RuleFormState {
  return {
    dispositions: { ...INHERIT_DISPOSITIONS },
    audience: { ...EMPTY_AUDIENCE_FORM, admins: true },
    piiChoice: "inherit",
    piiEntities: [],
    secretsChoice: "inherit",
    secretsPatterns: [],
    customAttributes: [],
  };
}

/**
 * The resolved policy a rule at `scopeType` inherits when a field is left on
 * "inherit": a project inherits its team baseline, a team or department the
 * organization baseline, and the organization the platform default. Used only
 * to label the "Inherit" choice with the value it currently resolves to.
 */
export function inheritedBaselineForScope({
  scopeType,
  effectiveTeam,
  effectiveOrganization,
}: {
  scopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "PROJECT";
  effectiveTeam: ResolvedDataPrivacy | null;
  effectiveOrganization: ResolvedDataPrivacy | null;
}): ResolvedDataPrivacy {
  if (scopeType === "PROJECT") {
    return (
      effectiveTeam ?? effectiveOrganization ?? PLATFORM_DEFAULT_DATA_PRIVACY
    );
  }
  if (scopeType === "TEAM" || scopeType === "DEPARTMENT") {
    return effectiveOrganization ?? PLATFORM_DEFAULT_DATA_PRIVACY;
  }
  return PLATFORM_DEFAULT_DATA_PRIVACY;
}

/**
 * Reverse of `buildRuleConfig`: hydrate the drawer's form state from a stored
 * config, for editing an existing rule. A field the config does not set shows
 * as "inherit" (not as a concrete default), so the drawer reflects exactly what
 * the rule pins versus what it leaves to the wider scope. The single audience
 * control is seeded from the first restrict category or restrict attribute rule,
 * which is what the drawer applies to every restricted item.
 */
export function configToFormState(config: DataPrivacyConfig): RuleFormState {
  const dispositions: Record<ContentCategory, CategoryChoice> = {
    ...INHERIT_DISPOSITIONS,
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
    piiChoice: config.pii?.level ?? "inherit",
    piiEntities: [...(config.pii?.entities ?? [])],
    secretsChoice: config.secrets
      ? config.secrets.enabled
        ? "on"
        : "off"
      : "inherit",
    secretsPatterns: [...(config.secrets?.customPatterns ?? [])],
    customAttributes: (config.customAttributes ?? []).map((rule) => ({
      pattern: rule.pattern,
      disposition: rule.disposition,
    })),
  };
}

const CATEGORY_SUMMARY_LABELS: Record<ContentCategory, string> = {
  input: "Input",
  output: "Output",
  system: "System instructions",
  tools: "Tool calls",
};

const PII_SUMMARY_LABELS: Record<PiiLevel, string> = {
  disabled: "PII redaction off",
  essential: "PII redaction",
  strict: "Strict PII redaction",
  custom: "Custom PII redaction",
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
  if (config.pii) {
    if (config.pii.level === "custom") {
      const count = config.pii.entities?.length ?? 0;
      parts.push(
        count === 1 ? "Custom PII (1 type)" : `Custom PII (${count} types)`,
      );
    } else {
      parts.push(PII_SUMMARY_LABELS[config.pii.level]);
    }
  }
  if (config.secrets) {
    parts.push(
      config.secrets.enabled ? "Secrets redaction" : "Secrets redaction off",
    );
    const patterns = config.secrets.customPatterns?.length ?? 0;
    if (patterns > 0) {
      parts.push(
        patterns === 1 ? "1 secret pattern" : `${patterns} secret patterns`,
      );
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "Inherits everything";
}

/** Whether the built config persists nothing (every control inherits). */
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
