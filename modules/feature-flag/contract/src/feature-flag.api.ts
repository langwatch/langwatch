import { moduleApi } from "@langwatch/kernel";
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
 * The one canonical feature flag capability: evaluation, operator
 * administration and the browser's authorized reads share this API because
 * they share the registry, targeting rules and cache invalidation.
 */
export interface FeatureFlagApi {
  /**
   * Full resolution: environment override, then force-enable list, then the
   * operator store's targeting rules, then the registry default. Throws
   * `UnknownFeatureFlagError` for a key the registry does not define.
   */
  isEnabled(flagKey: FeatureFlagKey, target: FeatureFlagTarget): Promise<boolean>;

  /**
   * Every browser-visible flag for one signed-in target, in one pass,
   * bounded by `FRONTEND_FEATURE_FLAGS`. An anonymous browser has its own,
   * narrower surface below.
   */
  resolveFrontendFlags(target: AuthenticatedExperimentTarget): Promise<FrontendFeatureFlagMap>;

  /**
   * The flags a signed-out browser may resolve, bounded by
   * `PUBLIC_ANONYMOUS_FEATURE_FLAGS` — reachable by anybody, so it must
   * never disclose the name or value of an ordinary frontend flag.
   */
  resolvePublicAnonymousFlags(target: {
    kind: "anonymous";
    anonymousId: string;
  }): Promise<PublicAnonymousFlagMap>;

  /**
   * Every experiment this target may see, with its effective value and
   * reason. An experiment it cannot see is absent, not present-and-false —
   * a signed-out visitor learns nothing about non-public experiments.
   */
  resolveExperimentCatalogue(
    target: ExperimentEvaluationTarget,
  ): Promise<ExperimentCatalogueEntry[]>;

  /**
   * A person's own enrolment: joining requires the experiment available to
   * the target; leaving removes the row (not a stored negative) so a later
   * tenant `enabled` still reaches them. Throws for an unknown/unavailable key.
   */
  setUserExperimentEnrolment(input: {
    flagKey: FrontendFeatureFlag;
    target: AuthenticatedExperimentTarget;
    enrolled: boolean;
  }): Promise<void>;

  /**
   * An owner's policy for one exact tenant scope the caller authorized.
   * Validates the key is a registered experiment; an unreleased experiment's
   * policy changes nothing until release. Throws for a non-experiment key.
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
   * tenant's tier first. A project is checked against the organization that
   * owns it, so a caller cannot pair a project with an org it is not in.
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

export const FeatureFlagApi = moduleApi<FeatureFlagApi>()("feature-flag");
