// ---------------------------------------------------------------------------
// @langwatch/ai-onboarding -- Public API
//
// Domain, ports and services. Adapters live behind the `./adapters` subpath.
// ---------------------------------------------------------------------------

export {
  ClaimService,
  type ClaimServiceDeps,
} from "./app/claim.service.js";
export {
  type Clock,
  type CreateEphemeralAccountParams,
  type EphemeralAccountRepository,
  type HandoffStore,
  type PasskeyCredential,
  type PasskeyRepository,
  type ProvisionedWorkspace,
  type RateLimitDecision,
  type RateLimiter,
  systemClock,
  type WebAuthnCeremony,
  type WorkspaceProvisioner,
} from "./app/ports.js";
export {
  ProvisioningService,
  type ProvisioningServiceDeps,
} from "./app/provisioning.service.js";
export {
  type CallerIdentity,
  RateLimitGuard,
} from "./app/rate-limit.guard.js";
export {
  computeDeadlines,
  daysRemainingInPhase,
  defaultProjectName,
  deriveState,
  type EphemeralAccount,
  toAccountRef,
  toLifecycle,
} from "./domain/account.js";
export {
  DEFAULT_HANDOFF_TTL_SECONDS,
  DEFAULT_INGESTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  defaultRateLimitConfig,
  type OnboardingConfig,
  type RateLimitConfig,
  type RateLimitRule,
  resolveConfig,
} from "./domain/config.js";
export { buildLifecycleNotice } from "./domain/copy.js";
export {
  AnonymousProvisioningDisabledError,
  ClaimHandoffNotFoundError,
  ClaimHandoffVerifierMismatchError,
  ClaimRequiresIdentityError,
  EphemeralAccountAlreadyClaimedError,
  EphemeralAccountExpiredError,
  EphemeralAccountNotFoundError,
  OnboardingRateLimitedError,
  OnboardingUnavailableError,
  PasskeyChallengeMissingError,
  PasskeyRegistrationFailedError,
} from "./domain/errors.js";
export { type ClaimHandoff, isHandoffExpired } from "./domain/handoff.js";
export { subnetKey } from "./domain/net.js";
export {
  deriveCodeChallenge,
  mintSecret,
  mintUserCode,
  peppered,
  secretsMatch,
  verifyCodeChallenge,
} from "./domain/tokens.js";
