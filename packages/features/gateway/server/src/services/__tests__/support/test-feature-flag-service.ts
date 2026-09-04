import { FeatureFlagService } from "@langwatch/feature-flag-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/**
 * Complete flag boundary backed by one switch. Tests that care about a gate
 * drive `enabled`; the rest of the contract stays refused.
 */
export class TestFeatureFlagService extends FeatureFlagService {
  enabled = true;

  isEnabled = async (): Promise<boolean> => this.enabled;

  resolveFrontendFlags = unsupported<FeatureFlagService["resolveFrontendFlags"]>();
  resolvePublicAnonymousFlags = unsupported<FeatureFlagService["resolvePublicAnonymousFlags"]>();
  resolveExperimentCatalogue = unsupported<FeatureFlagService["resolveExperimentCatalogue"]>();
  setUserExperimentEnrolment = unsupported<FeatureFlagService["setUserExperimentEnrolment"]>();
  setExperimentTenantPolicy = unsupported<FeatureFlagService["setExperimentTenantPolicy"]>();
  listOperatorCatalogue = unsupported<FeatureFlagService["listOperatorCatalogue"]>();
  setEnabled = unsupported<FeatureFlagService["setEnabled"]>();
  setRules = unsupported<FeatureFlagService["setRules"]>();
  clearStoredFlag = unsupported<FeatureFlagService["clearStoredFlag"]>();
}
