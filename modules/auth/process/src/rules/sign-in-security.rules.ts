import {
  SessionMaxLifetimeTooShortError,
  type LockoutPolicy,
  type SessionBound,
} from "@langwatch/auth-contract";
import type { SignInSecurityPolicy } from "@langwatch/organization-contract";

type RuleNumbers = {
  lockoutAfterFailedAttempts: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
};

const isActive = (settings: RuleNumbers): boolean =>
  settings.lockoutAfterFailedAttempts > 0 ||
  settings.sessionIdleTimeoutMinutes > 0 ||
  settings.sessionMaxLifetimeMinutes > 0;

/**
 * Whether this save turns a rule on from fully off - the only moment these
 * Enterprise-gated settings ask for the plan. Tuning an active rule, or
 * turning rules off, never asks again.
 */
export function willActivateSignInSecurity({
  current,
  next,
}: {
  current: RuleNumbers;
  next: RuleNumbers;
}): boolean {
  return !isActive(current) && isActive(next);
}

/** Refuses a real ceiling tighter than the idle timeout it would never let fire. */
export function assertSessionWindowSensible({
  sessionIdleTimeoutMinutes,
  sessionMaxLifetimeMinutes,
}: {
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
}): void {
  if (sessionMaxLifetimeMinutes > 0 && sessionMaxLifetimeMinutes < sessionIdleTimeoutMinutes) {
    throw new SessionMaxLifetimeTooShortError(
      `maximum session length of ${sessionMaxLifetimeMinutes} minutes is shorter than the idle timeout of ${sessionIdleTimeoutMinutes} minutes, which would make the idle timeout unreachable`,
    );
  }
}

/** The lockout half of the four columns an organization stores. */
export function toLockoutPolicy(policy: SignInSecurityPolicy): LockoutPolicy {
  return {
    afterFailedAttempts: policy.lockoutAfterFailedAttempts,
    lockMinutes: policy.lockoutMinutes,
  };
}

/** The session-window half of the four columns an organization stores. */
export function toSessionBound(policy: SignInSecurityPolicy): SessionBound {
  return {
    idleTimeoutMinutes: policy.sessionIdleTimeoutMinutes,
    maxLifetimeMinutes: policy.sessionMaxLifetimeMinutes,
  };
}
