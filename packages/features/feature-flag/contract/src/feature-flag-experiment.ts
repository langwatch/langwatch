import { z } from "zod";
import type { FeatureFlagTarget } from "./feature-flag-target";
import type { FrontendFeatureFlag } from "./frontend-feature-flags";

/**
 * The targets an experiment can be evaluated for.
 *
 * `system` is deliberately excluded rather than handled: it is a backend
 * kill-switch identity with no person, no browser and no tenant, so it can
 * neither enrol nor be bucketed. Excluding it from the type makes the
 * unanswerable case unrepresentable instead of silently answering it.
 */
export type ExperimentEvaluationTarget = Exclude<FeatureFlagTarget, { kind: "system" }>;

/**
 * The targets that carry a person, and so the only ones an enrolment can be
 * written for. Excluding `anonymous` here is what stops a browser id ever
 * reaching the enrolment table.
 */
export type AuthenticatedExperimentTarget = Exclude<
  ExperimentEvaluationTarget,
  { kind: "anonymous" }
>;

/**
 * Experiment metadata on a flag definition.
 *
 * A flag becomes an experiment by carrying this. `catalogueVersion` is
 * monotonic across the whole registry, so a browser can hold one watermark
 * and still tell whether anything new has appeared.
 *
 * `publicAnonymous` marks the narrow case of an experiment that runs before
 * anyone signs in. Such a flag has no user preference and no tenant scope to
 * consult, so it is decided by base availability and the anonymous bucket
 * alone. It must never guard authentication, entitlements or anything a
 * signed-out visitor should not reach.
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

/**
 * One experiment as a viewer sees it.
 *
 * Only experiments whose base availability is true for that viewer appear at
 * all, so registry metadata alone never announces something unreleased. An
 * experiment an owner has switched off stays visible — its base is still
 * available — so the owner can switch it back on and an ordinary member can
 * see why it is off.
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
 * Effective value of an experiment.
 *
 * Precedence, strongest first:
 *   1. base availability — operator row, targeting rules and rollout. An
 *      unavailable experiment is off for everyone and no lower choice can
 *      revive it.
 *   2. project policy, then organization policy. An explicit `enabled` or
 *      `disabled` at either scope decides, and the project wins over the
 *      organization.
 *   3. the individual's own opt-in.
 *
 * An anonymous target has neither a preference nor a tenant, so availability
 * alone decides it, and only for an experiment marked `publicAnonymous`.
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
 * Structural rules an experiment definition must satisfy, checked against
 * the registry at import so a bad definition fails the build rather than
 * shipping a half-usable experiment.
 *
 * An experiment is a thing a person turns on for themselves in the browser,
 * so it has to be reachable from the browser (`FRONTEND_FEATURE_FLAGS`) and
 * has to be a PRODUCT flag. A SYSTEM flag is a backend kill switch: it can
 * carry `envOverridable: false` and is resolved on paths that have no person
 * at all, so offering one as a personal choice would be a lie.
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
