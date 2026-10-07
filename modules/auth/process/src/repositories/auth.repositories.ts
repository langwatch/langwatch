import type { AuthRateLimitRepository } from "./auth-rate-limit.repository.ts";
import type { AuthSessionRepository } from "./auth-session.repository.ts";
import type { CliDeviceSessionRepository } from "./cli-device-session.repository.ts";
import type { SignInAttemptLockRepository } from "./sign-in-attempt-lock.repository.ts";
import type { SignUpVerificationTokenRepository } from "./signup-verification.repository.ts";

/**
 * Auth's browser-session rows, signup confirmation tokens, TTL'd CLI device
 * sessions, and the sign-in security rules and counters. Everything else it
 * reads belongs to another module and arrives as a peer or a member.
 */
export interface AuthRepositories {
  readonly sessions: AuthSessionRepository;
  readonly cliSessions: CliDeviceSessionRepository;
  readonly signUpTokens: SignUpVerificationTokenRepository;
  /** The consecutive-failure counter behind account lock-out (GAC-09). */
  readonly signInLocks: SignInAttemptLockRepository;
  /** The sign-in door's and the token check's fixed-window counters. */
  readonly rateLimits: AuthRateLimitRepository;
}
