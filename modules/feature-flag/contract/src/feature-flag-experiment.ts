import { z } from "zod";
import { frontendFeatureFlagSchema, type FrontendFeatureFlag } from "./frontend-feature-flags.ts";

/**
 * The targets an experiment can be evaluated for.
 *
 * `system` is deliberately excluded rather than handled: it is a backend
 * kill-switch identity with no person, no browser and no tenant, so it can
 * neither enrol nor be bucketed. Excluding it from the type makes the
 * unanswerable case unrepresentable instead of silently answering it.
 */
export type AuthenticatedExperimentTarget =
  | { kind: "project"; userId: string; projectId: string; organizationId: string }
  | { kind: "organization"; userId: string; organizationId: string }
  | { kind: "user"; userId: string };

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
 * An owner's policy for one tenant scope.
 *
 * `inherit` is the absence of a policy and delegates to the individual's own
 * opt-in. `enabled` and `disabled` are explicit and both outrank the
 * individual, so an owner can switch an experiment on for a whole project as
 * well as off.
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
 * Whether this target may see the experiment at all.
 *
 * A signed-out visitor sees only an experiment that explicitly opted into
 * pre-authentication evaluation. Everything else is invisible to them: no
 * value, no metadata, no acknowledgement it exists.
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
    if (!Number.isInteger(experiment.catalogueVersion) || experiment.catalogueVersion < 1) {
      violations.push(`${definition.key}: catalogueVersion must be a positive integer`);
    } else if (experiment.catalogueVersion <= previousVersion) {
      // The browser holds one watermark for the whole catalogue, so the
      // versions have to order: a repeated or lower number would make a
      // newly added experiment invisible to anyone already caught up.
      violations.push(
        `${definition.key}: catalogueVersion must be greater than every earlier experiment (saw ${experiment.catalogueVersion} after ${previousVersion})`,
      );
    } else {
      previousVersion = experiment.catalogueVersion;
    }

    if (experiment.publicAnonymous && !publicAnonymousKeys.includes(definition.key)) {
      violations.push(
        `${definition.key}: a publicAnonymous experiment must be listed in PUBLIC_ANONYMOUS_FEATURE_FLAGS`,
      );
    }
  }

  return violations;
}
