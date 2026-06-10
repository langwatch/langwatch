import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  type DataPrivacyConfig,
  type Disposition,
  type PiiLevel,
} from "~/server/data-privacy/dataPrivacy.types";

/**
 * Pure form-state to DataPrivacyConfig translation for the Add-privacy-rule
 * drawer. Only fields the user changed from the platform default end up in the
 * config, so a rule sets exactly what it means to and leaves everything else to
 * inherit down the cascade: captured categories, essential PII, and secrets-on
 * are the defaults and are omitted.
 */

export type RuleAudience = "admins" | "allMembers" | "noOne";

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
}: {
  dispositions: Record<ContentCategory, Disposition>;
  audience: RuleAudience;
  piiLevel: PiiLevel;
  secretsEnabled: boolean;
}): DataPrivacyConfig {
  const categories: NonNullable<DataPrivacyConfig["categories"]> = {};
  for (const category of CONTENT_CATEGORIES) {
    const disposition = dispositions[category];
    if (disposition === "drop") {
      categories[category] = { disposition: "drop" };
    } else if (disposition === "restrict") {
      categories[category] = {
        disposition: "restrict",
        audience: audienceConfig(audience),
      };
    }
  }

  const config: DataPrivacyConfig = {};
  if (Object.keys(categories).length > 0) config.categories = categories;
  if (piiLevel !== "essential") config.pii = { level: piiLevel };
  if (!secretsEnabled) config.secrets = { enabled: false };
  return config;
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

/** One-line human summary of a rule's config, for the rules table. */
export function ruleSummary(config: DataPrivacyConfig): string {
  const parts: string[] = [];
  for (const category of CONTENT_CATEGORIES) {
    const disposition = config.categories?.[category]?.disposition;
    if (disposition && disposition !== "capture") {
      parts.push(`${CATEGORY_SUMMARY_LABELS[category]} ${disposition}`);
    }
  }
  if (config.pii) parts.push(`PII ${PII_SUMMARY_LABELS[config.pii.level]}`);
  if (config.secrets && !config.secrets.enabled) parts.push("Secrets off");
  return parts.length > 0 ? parts.join(" · ") : "No changes";
}

/** Whether the form's config would actually change anything (gates Save). */
export function isEmptyRuleConfig(config: DataPrivacyConfig): boolean {
  return Object.keys(config).length === 0;
}
