import { featureApi } from "@langwatch/runtime-composition";
import type {
  AuthenticatedExperimentTarget,
  ExperimentCatalogueEntry,
  ExperimentEvaluationTarget,
  ExperimentTenantPolicy,
  ExperimentTenantScope,
} from "./feature-flag-experiment.ts";
import type { FeatureFlagRules } from "./feature-flag-rules.ts";
import type { FeatureFlagTarget } from "./feature-flag-target.ts";
import type { FeatureFlagKey } from "./feature-flag.ts";
import type {
  ExperimentEnrolmentForCaller,
  ExperimentTenantPolicyForCaller,
  FeatureFlagReadForCaller,
  FeatureFlagTargetRequestForCaller,
  FeatureFlagWrite,
  FrontendFeatureFlagMap,
  OperatorFeatureFlagCatalogue,
  OrganizationFeatureFlagsForCaller,
} from "./feature-flag.schemas.ts";
import type { FrontendFeatureFlag } from "./frontend-feature-flags.ts";
import type { PublicAnonymousFlagMap } from "./public-anonymous-feature-flags.ts";

/**
 * The one canonical feature flag capability.
 *
 * Evaluation, operator administration and the browser's own authorized reads
 * sit on the same API because they share the registry, the targeting rules and
 * the cache invalidation that makes an operator write visible to evaluation.
 */
export interface FeatureFlagApi {
  /**
   * Full resolution: environment override, then the force-enable list, then
   * the operator store with its targeting rules, then the registry default.
   *
   * Throws `UnknownFeatureFlagError` for a key the registry does not define.
   */
  isEnabled(flagKey: FeatureFlagKey, target: FeatureFlagTarget): Promise<boolean>;

  /**
   * Every browser-visible flag for one signed-in target, in one pass.
   *
   * Bounded by `FRONTEND_FEATURE_FLAGS`, and reachable only with a person
   * behind it: an anonymous browser has its own, narrower surface below.
   */
  resolveFrontendFlags(target: AuthenticatedExperimentTarget): Promise<FrontendFeatureFlagMap>;

  /**
   * The flags a signed-out browser may resolve.
   *
   * Bounded by `PUBLIC_ANONYMOUS_FEATURE_FLAGS`, which is a much shorter
   * list than the authenticated one: this answer is reachable by anybody,
   * so it must never disclose the name or value of an ordinary frontend
   * flag.
   */
  resolvePublicAnonymousFlags(target: {
    kind: "anonymous";
    anonymousId: string;
  }): Promise<PublicAnonymousFlagMap>;

  /**
   * Every experiment this target may see, with its effective value and the
   * reason for it.
   *
   * An experiment the target cannot see is absent, not present-and-false, so
   * a signed-out visitor learns nothing about experiments that are not
   * public.
   */
  resolveExperimentCatalogue(
    target: ExperimentEvaluationTarget,
  ): Promise<ExperimentCatalogueEntry[]>;

  /**
   * A person's own enrolment. Joining requires the experiment to be available
   * to that same target; leaving removes the row rather than storing a
   * negative, so a later tenant `enabled` still reaches them. Throws
   * `UnknownFeatureFlagExperimentError` for a key that is not an experiment,
   * and `FeatureFlagExperimentUnavailableError` for one not open to them.
   */
  setUserExperimentEnrolment(input: {
    flagKey: FrontendFeatureFlag;
    target: AuthenticatedExperimentTarget;
    enrolled: boolean;
  }): Promise<void>;

  /**
   * An owner's policy for one exact tenant scope. The caller supplies the
   * scope it authorized. Validates that the key is a registered experiment;
   * base availability still governs evaluation, so a policy on an
   * unreleased experiment changes nothing until it is released.
   *
   * Throws `UnknownFeatureFlagExperimentError` for a non-experiment key.
   */
  setExperimentTenantPolicy(input: {
    flagKey: FrontendFeatureFlag;
    scope: ExperimentTenantScope;
    policy: ExperimentTenantPolicy;
    changedByUserId: string;
  }): Promise<void>;

  listOperatorCatalogue(): Promise<OperatorFeatureFlagCatalogue>;

  setEnabled(input: FeatureFlagWrite & { enabled: boolean }): Promise<void>;

  setRules(input: FeatureFlagWrite & { rules: FeatureFlagRules }): Promise<void>;

  clearStoredFlag(input: FeatureFlagWrite): Promise<void>;

  /**
   * One flag for the tenant a signed-in caller named, authorized at that
   * tenant's own tier before the flag is read. A project is checked against
   * the organization that actually owns it, so a caller cannot pair a project
   * with an organization it is not in.
   */
  isEnabledForCaller(input: FeatureFlagReadForCaller): Promise<boolean>;

  /**
   * The flag for each organization the caller belongs to. Organizations they
   * are not a member of are absent rather than present-and-false, so the
   * answer cannot be read as a membership oracle.
   */
  isEnabledByOrganizationForCaller(
    input: OrganizationFeatureFlagsForCaller,
  ): Promise<Record<string, boolean>>;

  /** Every browser-visible flag for the exact tenant target the caller may view. */
  resolveFrontendFlagsForCaller(
    input: FeatureFlagTargetRequestForCaller,
  ): Promise<FrontendFeatureFlagMap>;

  /**
   * The caller's experiments for that target, with tenant policy present only
   * for a caller who may manage it: policies are manager data, and a viewer
   * sees the entry without them.
   */
  listExperimentsForCaller(
    input: FeatureFlagTargetRequestForCaller,
  ): Promise<ExperimentCatalogueEntry[]>;

  /** The caller's own enrolment, for a target they may view. */
  setExperimentEnrolmentForCaller(input: ExperimentEnrolmentForCaller): Promise<void>;

  /** A tenant policy, for a caller who may manage experiments in that scope. */
  setExperimentTenantPolicyForCaller(input: ExperimentTenantPolicyForCaller): Promise<void>;
}

export const FeatureFlagApi = featureApi<FeatureFlagApi>("feature-flag");
