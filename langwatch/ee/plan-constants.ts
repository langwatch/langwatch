import { DEFAULT_LIMIT } from "./licensing/constants";
import type { LicensePlanLimits } from "./licensing/types";

/**
 * Single source of truth for plan definitions (ADR-039 Decision 7 /
 * Invariant I7, resolves Stripe-assessment hazard H11).
 *
 * SaaS subscription plans (`ee/billing/planLimits.ts`) and self-hosted
 * license generation templates (`ee/licensing/planTemplates.ts`) previously
 * declared the "same" plans in two unrelated files, so their values drifted
 * silently. Both now read from this module. Where the license and SaaS
 * variants of a plan deliberately differ, the difference is declared here,
 * side by side, with the reason — never implicitly in two files.
 *
 * NOTE on issued licenses: license validation reads the SIGNED PAYLOAD, not
 * these templates — changing a template here only affects licenses generated
 * afterwards. The `evaluationsCredit` field is legacy but must stay on the
 * generation side for payload-schema stability (see licensing/types.ts).
 */

/**
 * GROWTH license template: unlimited everything except maxMembers, which is
 * supplied at generation time from the purchased seat quantity. The SaaS
 * seat-event counterpart lives in planLimits.ts (metered events, seat-priced)
 * — deliberately different: licenses cap by payload, SaaS bills by usage.
 */
export const GROWTH_LICENSE_TEMPLATE: Omit<LicensePlanLimits, "maxMembers"> = {
  type: "GROWTH",
  name: "Growth",
  maxMembersLite: DEFAULT_LIMIT,
  maxTeams: DEFAULT_LIMIT,
  maxProjects: DEFAULT_LIMIT,
  maxMessagesPerMonth: DEFAULT_LIMIT,
  evaluationsCredit: 0,
  maxWorkflows: DEFAULT_LIMIT,
  maxPrompts: DEFAULT_LIMIT,
  maxEvaluators: DEFAULT_LIMIT,
  maxScenarios: DEFAULT_LIMIT,
  maxAgents: DEFAULT_LIMIT,
  maxExperiments: DEFAULT_LIMIT,
  maxOnlineEvaluations: DEFAULT_LIMIT,
  maxDatasets: DEFAULT_LIMIT,
  maxDashboards: DEFAULT_LIMIT,
  maxCustomGraphs: DEFAULT_LIMIT,
  maxAutomations: DEFAULT_LIMIT,
  canPublish: true,
  usageUnit: "events",
};

/**
 * PRO license template. The SaaS PRO subscription (planLimits.ts) is a legacy
 * tiered plan with different caps (5 members / 10k messages) — deliberate:
 * the license variant was sized for self-hosted teams.
 */
export const PRO_LICENSE_TEMPLATE: LicensePlanLimits = {
  type: "PRO",
  name: "Pro",
  maxMembers: 10,
  maxMembersLite: 5,
  maxTeams: 10,
  maxProjects: 20,
  maxMessagesPerMonth: 100000,
  evaluationsCredit: 0,
  maxWorkflows: 50,
  maxPrompts: 50,
  maxEvaluators: 50,
  maxScenarios: 50,
  maxAgents: 50,
  maxExperiments: 50,
  maxOnlineEvaluations: 50,
  maxDatasets: 50,
  maxDashboards: 50,
  maxCustomGraphs: 50,
  maxAutomations: 50,
  canPublish: true,
  usageUnit: "traces",
};

/**
 * ENTERPRISE license template. The SaaS ENTERPRISE subscription
 * (planLimits.ts) carries different caps (1000 members / 1M messages) —
 * a known divergence inherited from before unification; reconciling the
 * values is a product decision, tracked in ADR-039's open questions. Keeping
 * both declared here makes the divergence visible instead of silent.
 */
export const ENTERPRISE_LICENSE_TEMPLATE: LicensePlanLimits = {
  type: "ENTERPRISE",
  name: "Enterprise",
  maxMembers: 100,
  maxMembersLite: 50,
  maxTeams: 100,
  maxProjects: 500,
  maxMessagesPerMonth: 10000000,
  evaluationsCredit: 0,
  maxWorkflows: 1000,
  maxPrompts: 1000,
  maxEvaluators: 1000,
  maxScenarios: 1000,
  maxAgents: 1000,
  maxExperiments: 1000,
  maxOnlineEvaluations: 1000,
  maxDatasets: 1000,
  maxDashboards: 1000,
  maxCustomGraphs: 1000,
  maxAutomations: 1000,
  canPublish: true,
  usageUnit: "traces",
};
