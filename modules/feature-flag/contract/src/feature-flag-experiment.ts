import { z } from "zod";

import { frontendFeatureFlagSchema, type FrontendFeatureFlag } from "./frontend-feature-flags.ts";

/**
 * The targets an experiment can be evaluated for. `system` is deliberately
 * excluded: it is a backend kill-switch identity with no person, browser or
 * tenant, so excluding it makes the unanswerable case unrepresentable.
 */
export type AuthenticatedExperimentTarget =
  | {
      kind: "project";
      userId: string;
      projectId: string;
      organizationId: string;
      userEmail?: string;
    }
  | { kind: "organization"; userId: string; organizationId: string; userEmail?: string }
  | { kind: "user"; userId: string; userEmail?: string };

export type ExperimentEvaluationTarget =
  | AuthenticatedExperimentTarget
  | { kind: "anonymous"; anonymousId: string };

/**
 * Experiment metadata on a flag definition; `publicAnonymous` guards
 * pre-sign-in experiments only.
 */
export interface FeatureFlagExperiment {
  /** Shown in the Experiments dialog. Customer-facing copy, not the key. */
  title: string;
  summary: string;
  /** Monotonic across the registry; raised when an experiment is added. */
  catalogueVersion: number;
  publicAnonymous?: true;
}

/**
 * An owner's policy for one tenant scope. `inherit` delegates to the
 * individual's own opt-in; `enabled`/`disabled` are explicit and outrank
 * it, so an owner can switch an experiment on or off for a whole project.
 */
export const experimentTenantPolicySchema = z.enum(["inherit", "enabled", "disabled"]);

export type ExperimentTenantPolicy = z.infer<typeof experimentTenantPolicySchema>;

/** The exact scope a tenant policy is written against. */
export const experimentTenantScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectId: z.string().min(1) }),
  z.object({ kind: z.literal("organization"), organizationId: z.string().min(1) }),
]);

export type ExperimentTenantScope = z.infer<typeof experimentTenantScopeSchema>;

/**
 * Why an experiment resolved the way it did, for the dialog to explain and
 * for tests to assert against something other than a bare boolean.
 */
export type ExperimentDecision =
  | "unavailable"
  | "tenant-disabled"
  | "tenant-enabled"
  | "user-enrolled"
  | "user-not-enrolled"
  | "anonymous-bucket";

export const experimentDecisionSchema = z.enum([
  "unavailable",
  "tenant-disabled",
  "tenant-enabled",
  "user-enrolled",
  "user-not-enrolled",
  "anonymous-bucket",
]);

/**
 * One experiment as a viewer sees it (only those with true base availability
 * for that viewer).
 */
export interface ExperimentCatalogueEntry {
  key: FrontendFeatureFlag;
  title: string;
  summary: string;
  catalogueVersion: number;
  enabled: boolean;
  decision: ExperimentDecision;
  /** The viewer's own opt-in, independent of any tenant policy. */
  userEnrolled: boolean;
  /** Present only for a viewer authorised to manage that scope. */
  projectPolicy?: ExperimentTenantPolicy;
  organizationPolicy?: ExperimentTenantPolicy;
}

export const experimentCatalogueEntrySchema = z
  .object({
    key: frontendFeatureFlagSchema,
    title: z.string(),
    summary: z.string(),
    catalogueVersion: z.number().int().positive(),
    enabled: z.boolean(),
    decision: experimentDecisionSchema,
    userEnrolled: z.boolean(),
    projectPolicy: experimentTenantPolicySchema.optional(),
    organizationPolicy: experimentTenantPolicySchema.optional(),
  })
  .strict();

/**
 * Whether this target may see the experiment at all. A signed-out visitor
 * sees only an experiment that opted into pre-authentication evaluation —
 * everything else is invisible: no value, no metadata, no acknowledgement.
 */
export function isExperimentVisibleToTarget({
  experiment,
  target,
}: {
  experiment: FeatureFlagExperiment;
  target: ExperimentEvaluationTarget;
}): boolean {
  if (target.kind === "anonymous") return experiment.publicAnonymous === true;

  return true;
}

/**
 * Effective value of an experiment: base availability (operator, targeting,
 * rollout), then project/org policy, then individual opt-in.
 */
export function resolveExperimentDecision({
  experiment,
  target,
  available,
  projectPolicy,
  organizationPolicy,
  userEnrolled,
}: {
  experiment: FeatureFlagExperiment;
  target: ExperimentEvaluationTarget;
  available: boolean;
  projectPolicy: ExperimentTenantPolicy;
  organizationPolicy: ExperimentTenantPolicy;
  userEnrolled: boolean;
}): { enabled: boolean; decision: ExperimentDecision } {
  if (!isExperimentVisibleToTarget({ experiment, target })) {
    return { enabled: false, decision: "unavailable" };
  }
  if (!available) return { enabled: false, decision: "unavailable" };

  if (target.kind === "anonymous") {
    // No preference and no tenant exist before sign-in, so availability —
    // which already includes the anonymous bucket — is the whole answer.
    return { enabled: true, decision: "anonymous-bucket" };
  }

  const tenantPolicy = projectPolicy !== "inherit" ? projectPolicy : organizationPolicy;
  if (tenantPolicy === "disabled") {
    return { enabled: false, decision: "tenant-disabled" };
  }
  if (tenantPolicy === "enabled") {
    return { enabled: true, decision: "tenant-enabled" };
  }

  return userEnrolled
    ? { enabled: true, decision: "user-enrolled" }
    : { enabled: false, decision: "user-not-enrolled" };
}

function listingViolations({
  definition,
  experiment,
  browserVisibleKeys,
}: {
  definition: { key: string; scope: "SYSTEM" | "PRODUCT" };
  experiment: FeatureFlagExperiment;
  browserVisibleKeys: readonly string[];
}): string[] {
  const violations: string[] = [];
  if (definition.scope !== "PRODUCT") {
    violations.push(
      `${definition.key}: an experiment must be a PRODUCT flag, not ${definition.scope}`,
    );
  }
  if (!browserVisibleKeys.includes(definition.key)) {
    violations.push(`${definition.key}: an experiment must be listed in FRONTEND_FEATURE_FLAGS`);
  }
  if (experiment.title.trim() === "" || experiment.summary.trim() === "") {
    violations.push(`${definition.key}: an experiment needs a title and a summary`);
  }
  return violations;
}

/**
 * The browser holds one watermark for the whole catalogue, so versions have to order: a repeated
 * or lower number would make a newly added experiment invisible to anyone already caught up.
 */
function catalogueVersionViolations({
  key,
  version,
  previousVersion,
}: {
  key: string;
  version: number;
  previousVersion: number;
}): string[] {
  if (!Number.isInteger(version) || version < 1) {
    return [`${key}: catalogueVersion must be a positive integer`];
  }
  if (version <= previousVersion) {
    return [
      `${key}: catalogueVersion must be greater than every earlier experiment (saw ${version} after ${previousVersion})`,
    ];
  }
  return [];
}

/**
 * Structural rules an experiment definition must satisfy; experiments must be
 * PRODUCT flags (not SYSTEM) reachable from the browser.
 */
export function findExperimentDefinitionViolations({
  definitions,
  browserVisibleKeys,
  publicAnonymousKeys = [],
}: {
  definitions: readonly {
    key: string;
    scope: "SYSTEM" | "PRODUCT";
    experiment?: FeatureFlagExperiment;
  }[];
  browserVisibleKeys: readonly string[];
  publicAnonymousKeys?: readonly string[];
}): string[] {
  const violations: string[] = [];
  let previousVersion = 0;

  for (const definition of definitions) {
    const { experiment } = definition;
    if (!experiment) continue;

    violations.push(...listingViolations({ definition, experiment, browserVisibleKeys }));
    const versionViolations = catalogueVersionViolations({
      key: definition.key,
      version: experiment.catalogueVersion,
      previousVersion,
    });
    violations.push(...versionViolations);
    if (versionViolations.length === 0) previousVersion = experiment.catalogueVersion;

    if (experiment.publicAnonymous && !publicAnonymousKeys.includes(definition.key)) {
      violations.push(
        `${definition.key}: a publicAnonymous experiment must be listed in PUBLIC_ANONYMOUS_FEATURE_FLAGS`,
      );
    }
  }

  return violations;
}
