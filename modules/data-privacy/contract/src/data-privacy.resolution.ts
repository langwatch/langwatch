import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ContentCategory,
  type DataPrivacyConfig,
  type DataPrivacyRow,
  type DataPrivacyScopeFacts,
  type ResolvedDataPrivacy,
  resolveAudience,
} from "./data-privacy.ts";

type Candidate = {
  scopeType: DataPrivacyRow["scopeType"];
  scopeId: string;
  personalOnly: boolean;
};

export function buildDataPrivacyChain(facts: DataPrivacyScopeFacts): Candidate[] {
  const chain: Candidate[] = [
    { scopeType: "PROJECT", scopeId: facts.projectId, personalOnly: false },
  ];
  if (facts.departmentId) {
    if (facts.isPersonal) {
      chain.push({
        scopeType: "DEPARTMENT",
        scopeId: facts.departmentId,
        personalOnly: true,
      });
    }
    chain.push({
      scopeType: "DEPARTMENT",
      scopeId: facts.departmentId,
      personalOnly: false,
    });
  }
  chain.push({ scopeType: "TEAM", scopeId: facts.teamId, personalOnly: false });
  if (facts.isPersonal) {
    chain.push({
      scopeType: "ORGANIZATION",
      scopeId: facts.organizationId,
      personalOnly: true,
    });
  }
  chain.push({
    scopeType: "ORGANIZATION",
    scopeId: facts.organizationId,
    personalOnly: false,
  });
  return chain;
}

type ResolvedCategory = ResolvedDataPrivacy["categories"][ContentCategory];
type ResolvedAttributeRule = ResolvedDataPrivacy["customAttributes"][number];

/** The configs that apply, nearest scope first. */
function configsNearestFirst(input: {
  rows: DataPrivacyRow[];
  facts: DataPrivacyScopeFacts;
}): DataPrivacyConfig[] {
  return buildDataPrivacyChain(input.facts).flatMap((candidate) => {
    const row = input.rows.find(
      (item) =>
        item.scopeType === candidate.scopeType &&
        item.scopeId === candidate.scopeId &&
        item.personalOnly === candidate.personalOnly,
    );
    return row ? [row.config] : [];
  });
}

/** The nearest scope that sets this category wins; otherwise the platform default. */
function resolveCategory(
  configs: DataPrivacyConfig[],
  category: ContentCategory,
): ResolvedCategory {
  const setting = configs.find((config) => config.categories?.[category])?.categories?.[category];
  if (!setting) return { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories[category] };

  return { disposition: setting.disposition, audience: resolveAudience(setting.audience) };
}

function resolvePii(configs: DataPrivacyConfig[]): ResolvedDataPrivacy["pii"] {
  const exceptPatterns = [
    ...new Set(configs.flatMap((config) => config.pii?.exceptPatterns ?? [])),
  ];
  const nearest = configs.find((config) => config.pii)?.pii;
  if (!nearest) return { ...PLATFORM_DEFAULT_DATA_PRIVACY.pii, exceptPatterns };

  return { level: nearest.level, entities: nearest.entities ?? [], exceptPatterns };
}

/** Per pattern, the nearest scope's rule wins. */
function resolveCustomAttributes(configs: DataPrivacyConfig[]): ResolvedAttributeRule[] {
  const rules = new Map<string, ResolvedAttributeRule>();
  for (const rule of configs.flatMap((config) => config.customAttributes ?? [])) {
    if (rules.has(rule.pattern)) continue;
    rules.set(rule.pattern, {
      pattern: rule.pattern,
      disposition: rule.disposition,
      audience: resolveAudience(rule.audience),
    });
  }
  return [...rules.values()];
}

export function resolveDataPrivacy(input: {
  rows: DataPrivacyRow[];
  facts: DataPrivacyScopeFacts;
}): ResolvedDataPrivacy {
  const configs = configsNearestFirst(input);
  const nearestSecrets = configs.find((config) => config.secrets)?.secrets;

  return {
    categories: {
      input: resolveCategory(configs, "input"),
      output: resolveCategory(configs, "output"),
      system: resolveCategory(configs, "system"),
      tools: resolveCategory(configs, "tools"),
    },
    pii: resolvePii(configs),
    secrets: {
      enabled: nearestSecrets
        ? nearestSecrets.enabled
        : PLATFORM_DEFAULT_DATA_PRIVACY.secrets.enabled,
      customPatterns: [
        ...new Set(configs.flatMap((config) => config.secrets?.customPatterns ?? [])),
      ],
    },
    customAttributes: resolveCustomAttributes(configs),
  };
}
