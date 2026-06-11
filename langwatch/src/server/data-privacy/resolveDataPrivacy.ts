import {
  CONTENT_CATEGORIES,
  type DataPrivacyConfig,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
  resolveAudience,
} from "./dataPrivacy.types";

/**
 * A stored privacy rule, narrowed to what the cascade needs.
 */
export interface DataPrivacyRow {
  scopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "PROJECT";
  scopeId: string;
  personalOnly: boolean;
  config: DataPrivacyConfig;
}

/**
 * The facts about a project the cascade resolves against. `departmentId` is the
 * resolved `dept(P)`: for a personal project it is the OWNER's department; for a
 * regular project it is the project's own department. The caller resolves which
 * (so the resolver stays a pure function), matching how `AiToolEntryDepartment`
 * matches `OrganizationUser.departmentId`.
 */
export interface DataPrivacyScopeFacts {
  organizationId: string;
  teamId: string;
  projectId: string;
  departmentId: string | null;
  isPersonal: boolean;
}

interface Candidate {
  scopeType: DataPrivacyRow["scopeType"];
  scopeId: string;
  personalOnly: boolean;
}

/**
 * The scope cascade for a project, most-specific first:
 *   PROJECT
 *   DEPARTMENT (personalOnly)   — only for personal projects
 *   DEPARTMENT
 *   TEAM
 *   ORGANIZATION (personalOnly) — only for personal projects ("all personal projects")
 *   ORGANIZATION
 *
 * Precedence DEPARTMENT > TEAM is the documented default (the people lens beats
 * the structural one); per-field merge makes conflicts rare. personalOnly
 * candidates rank just above their non-personal counterpart at the same tier.
 */
export function buildDataPrivacyChain(
  facts: DataPrivacyScopeFacts,
): Candidate[] {
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

/**
 * Resolve a project's effective privacy policy from the stored rules.
 *
 * Each field resolves independently: walking the chain most-specific first, the
 * first rule that SETS a field wins; unset fields fall through to the platform
 * defaults. List fields (`customAttributes`, `secrets.customPatterns`) instead
 * UNION across every matching rule in the chain (org baseline + narrower
 * additions both apply); for `customAttributes` the union is per pattern, the
 * most-specific scope winning when two tiers set the same pattern. The
 * `secrets.enabled` flag is first-set-wins, but its `customPatterns` accumulate
 * regardless.
 */
export function resolveDataPrivacy({
  rows,
  facts,
}: {
  rows: DataPrivacyRow[];
  facts: DataPrivacyScopeFacts;
}): ResolvedDataPrivacy {
  const chain = buildDataPrivacyChain(facts);

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

  const setCategory: Record<string, boolean> = {};
  let setPii = false;
  let setSecretsEnabled = false;
  // Per attribute pattern, the first (most-specific) entry in the chain wins.
  const attributeRules = new Map<
    string,
    ResolvedDataPrivacy["customAttributes"][number]
  >();
  const customPatterns = new Set<string>();

  for (const candidate of chain) {
    const row = rows.find(
      (r) =>
        r.scopeType === candidate.scopeType &&
        r.scopeId === candidate.scopeId &&
        r.personalOnly === candidate.personalOnly,
    );
    if (!row) continue;
    const config = row.config;

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
      resolved.pii = { level: config.pii.level };
      setPii = true;
    }

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
    for (const pattern of config.secrets?.customPatterns ?? [])
      customPatterns.add(pattern);
  }

  resolved.customAttributes = [...attributeRules.values()];
  resolved.secrets.customPatterns = [...customPatterns];
  return resolved;
}
