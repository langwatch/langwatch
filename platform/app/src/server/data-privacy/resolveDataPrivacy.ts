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
  const acc = createAccumulator();

  for (const candidate of chain) {
    const row = findCandidateRow({ rows, candidate });
    if (!row) continue;
    const config = row.config;

    applyCategories({ config, acc });
    applyPii({ config, acc });
    applySecretsEnabled({ config, acc });
    applyCustomAttributes({ config, acc });
    applySecretPatterns({ config, acc });
  }

  const { resolved } = acc;
  resolved.customAttributes = [...acc.attributeRules.values()];
  resolved.secrets.customPatterns = [...acc.customPatterns];
  resolved.pii.exceptPatterns = [...acc.piiExceptPatterns];
  return resolved;
}

interface Accumulator {
  resolved: ResolvedDataPrivacy;
  setCategory: Record<string, boolean>;
  setPii: boolean;
  setSecretsEnabled: boolean;
  piiExceptPatterns: Set<string>;
  /** Per attribute pattern, the first (most-specific) entry in the chain wins. */
  attributeRules: Map<string, ResolvedDataPrivacy["customAttributes"][number]>;
  customPatterns: Set<string>;
}

function createAccumulator(): Accumulator {
  return {
    resolved: {
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
    },
    setCategory: {},
    setPii: false,
    setSecretsEnabled: false,
    piiExceptPatterns: new Set<string>(),
    attributeRules: new Map(),
    customPatterns: new Set<string>(),
  };
}

function findCandidateRow({
  rows,
  candidate,
}: {
  rows: DataPrivacyRow[];
  candidate: Candidate;
}): DataPrivacyRow | undefined {
  return rows.find(
    (r) =>
      r.scopeType === candidate.scopeType &&
      r.scopeId === candidate.scopeId &&
      r.personalOnly === candidate.personalOnly,
  );
}

type Applied = { config: DataPrivacyConfig; acc: Accumulator };

function applyCategories({ config, acc }: Applied): void {
  for (const category of CONTENT_CATEGORIES) {
    const setting = config.categories?.[category];
    if (setting && !acc.setCategory[category]) {
      acc.resolved.categories[category] = {
        disposition: setting.disposition,
        audience: resolveAudience(setting.audience),
      };
      acc.setCategory[category] = true;
    }
  }
}

function applyPii({ config, acc }: Applied): void {
  if (config.pii && !acc.setPii) {
    acc.resolved.pii = {
      level: config.pii.level,
      entities: config.pii.entities ?? [],
      exceptPatterns: [],
    };
    acc.setPii = true;
  }
  // Like secret customPatterns, exceptions accumulate across the whole chain
  // even though the level itself is first-set-wins: an org-wide exception for
  // a company id format applies no matter which scope pinned the level.
  for (const pattern of config.pii?.exceptPatterns ?? [])
    acc.piiExceptPatterns.add(pattern);
}

function applySecretsEnabled({ config, acc }: Applied): void {
  if (config.secrets && !acc.setSecretsEnabled) {
    acc.resolved.secrets.enabled = config.secrets.enabled;
    acc.setSecretsEnabled = true;
  }
}

function applyCustomAttributes({ config, acc }: Applied): void {
  for (const rule of config.customAttributes ?? []) {
    if (!acc.attributeRules.has(rule.pattern)) {
      acc.attributeRules.set(rule.pattern, {
        pattern: rule.pattern,
        disposition: rule.disposition,
        audience: resolveAudience(rule.audience),
      });
    }
  }
}

function applySecretPatterns({ config, acc }: Applied): void {
  for (const pattern of config.secrets?.customPatterns ?? [])
    acc.customPatterns.add(pattern);
}
