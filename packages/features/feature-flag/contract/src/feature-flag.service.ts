import type { FeatureFlagKey } from "./feature-flag";
import type { FeatureFlagRules } from "./feature-flag-rules";
import type {
  AuthenticatedExperimentTarget,
  ExperimentCatalogueEntry,
  ExperimentEvaluationTarget,
  ExperimentTenantPolicy,
  ExperimentTenantScope,
} from "./feature-flag-experiment";
import type { PublicAnonymousFlagMap } from "./public-anonymous-feature-flags";
import type { FrontendFeatureFlag } from "./frontend-feature-flags";
import type { FeatureFlagScope } from "./feature-flag";
import type { FeatureFlagTarget } from "./feature-flag-target";

/** One operator-written row, as the operator surfaces read it back. */
export interface StoredFeatureFlag {
  key: string;
  enabled: boolean;
  rules: FeatureFlagRules;
  lastEditedBy: string | null;
  updatedAt: Date;
}

/** Every browser-visible flag, resolved for one target. */
export type FrontendFeatureFlagMap = Record<FrontendFeatureFlag, boolean>;

export interface FeatureFlagWrite {
  key: string;
  lastEditedBy: string | null;
}

export interface OperatorFeatureFlag {
  key: string;
  scope: FeatureFlagScope;
  defaultValue: boolean;
  description: string;
  family: string | null;
  storedValue: boolean | null;
  rules: FeatureFlagRules;
  envOverride: boolean | null;
  effective: boolean;
  lastEditedBy: string | null;
  updatedAt: Date | null;
}

export interface OperatorFeatureFlagFamily {
  family: string;
  keyPrefix: string;
  scope: FeatureFlagScope;
  defaultValue: boolean;
  description: string;
}

export interface OperatorFeatureFlagCatalogue {
  flags: OperatorFeatureFlag[];
  families: OperatorFeatureFlagFamily[];
}

/**
 * The one canonical feature flag capability.
 *
 * Evaluation and operator administration sit on the same service because
 * they share the registry, the targeting rules and the cache invalidation
 * that makes an operator write visible to evaluation.
 */
export abstract class FeatureFlagService {
  /**
   * Full resolution: environment override, then the force-enable list, then
   * the operator store with its targeting rules, then the registry default.
   *
   * Throws `UnknownFeatureFlagError` for a key the registry does not define.
   */
  abstract isEnabled(flagKey: FeatureFlagKey, target: FeatureFlagTarget): Promise<boolean>;

  /**
   * Every browser-visible flag for one signed-in target, in one pass.
   *
   * Bounded by `FRONTEND_FEATURE_FLAGS`, and reachable only with a person
   * behind it: an anonymous browser has its own, narrower surface below.
   */
  abstract resolveFrontendFlags(
    target: AuthenticatedExperimentTarget,
  ): Promise<FrontendFeatureFlagMap>;

  /**
   * The flags a signed-out browser may resolve.
   *
   * Bounded by `PUBLIC_ANONYMOUS_FEATURE_FLAGS`, which is a much shorter
   * list than the authenticated one: this answer is reachable by anybody,
   * so it must never disclose the name or value of an ordinary frontend
   * flag.
   */
  abstract resolvePublicAnonymousFlags(target: {
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
  abstract resolveExperimentCatalogue(
    target: ExperimentEvaluationTarget,
  ): Promise<ExperimentCatalogueEntry[]>;

  /**
   * A person's own enrolment.
   *
   * Joining requires the experiment to be available to that same target, so
   * an enrolment row can never be written for someone outside the rollout.
   * Leaving removes the row rather than storing a negative, so a later
   * tenant `enabled` still reaches them.
   *
   * Throws `UnknownFeatureFlagExperimentError` for a key that is not a
   * registered experiment, and `FeatureFlagExperimentUnavailableError` when
   * joining something not open to that target.
   */
  abstract setUserExperimentEnrolment(input: {
    flagKey: FrontendFeatureFlag;
    target: AuthenticatedExperimentTarget;
    enrolled: boolean;
  }): Promise<void>;

  /**
   * An owner's policy for one exact tenant scope. The transport supplies the
   * scope it authorized. Validates that the key is a registered experiment;
   * base availability still governs evaluation, so a policy on an
   * unreleased experiment changes nothing until it is released.
   *
   * Throws `UnknownFeatureFlagExperimentError` for a non-experiment key.
   */
  abstract setExperimentTenantPolicy(input: {
    flagKey: FrontendFeatureFlag;
    scope: ExperimentTenantScope;
    policy: ExperimentTenantPolicy;
    changedByUserId: string;
  }): Promise<void>;

  abstract listOperatorCatalogue(): Promise<OperatorFeatureFlagCatalogue>;

  abstract setEnabled(input: FeatureFlagWrite & { enabled: boolean }): Promise<void>;

  abstract setRules(input: FeatureFlagWrite & { rules: FeatureFlagRules }): Promise<void>;

  abstract clearStoredFlag(input: FeatureFlagWrite): Promise<void>;
}
