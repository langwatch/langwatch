import {
  CONTENT_CATEGORIES,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyConfig,
  type DataPrivacyRow,
  type DataPrivacyScopeFacts,
  type ResolvedDataPrivacy,
  resolveAudience,
} from "./data-privacy";

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

export function resolveDataPrivacy(input: {
  rows: DataPrivacyRow[];
  facts: DataPrivacyScopeFacts;
}): ResolvedDataPrivacy {
  const resolved: ResolvedDataPrivacy = {
    categories: {
      input: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.input },
      output: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.output },
      system: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.system },
      tools: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.tools },
    },
    pii: { ...PLATFORM_DEFAULT_DATA_PRIVACY.pii },
    secrets: {
      enabled: PLATFORM_DEFAULT_DATA_PRIVACY.secrets.enabled,
      customPatterns: [],
    },
    customAttributes: [],
  };
  const setCategory: Partial<Record<(typeof CONTENT_CATEGORIES)[number], boolean>> = {};
  let setPii = false;
  let setSecretsEnabled = false;
  const piiExceptPatterns = new Set<string>();
  const attributeRules = new Map<string, ResolvedDataPrivacy["customAttributes"][number]>();
  const customPatterns = new Set<string>();

  for (const candidate of buildDataPrivacyChain(input.facts)) {
    const row = input.rows.find(
      (item) =>
        item.scopeType === candidate.scopeType &&
        item.scopeId === candidate.scopeId &&
        item.personalOnly === candidate.personalOnly,
    );
    if (!row) continue;
    const config: DataPrivacyConfig = row.config;
    for (const category of CONTENT_CATEGORIES) {
      const setting = config.categories?.[category];
      if (setting && !setCategory[category]) {
        resolved.categories[category] = {
          disposition: setting.disposition,
          audience: resolveAudience(setting.audience),
        };
        setCategory[category] = true;
      }
    }
    if (config.pii && !setPii) {
      resolved.pii = {
        level: config.pii.level,
        entities: config.pii.entities ?? [],
        exceptPatterns: [],
      };
      setPii = true;
    }
    for (const pattern of config.pii?.exceptPatterns ?? []) piiExceptPatterns.add(pattern);
    if (config.secrets && !setSecretsEnabled) {
      resolved.secrets.enabled = config.secrets.enabled;
      setSecretsEnabled = true;
    }
    for (const rule of config.customAttributes ?? []) {
      if (!attributeRules.has(rule.pattern)) {
        attributeRules.set(rule.pattern, {
          pattern: rule.pattern,
          disposition: rule.disposition,
          audience: resolveAudience(rule.audience),
        });
      }
    }
    for (const pattern of config.secrets?.customPatterns ?? []) customPatterns.add(pattern);
  }
  resolved.customAttributes = [...attributeRules.values()];
  resolved.secrets.customPatterns = [...customPatterns];
  resolved.pii.exceptPatterns = [...piiExceptPatterns];
  return resolved;
}
