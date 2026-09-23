import type { AuthSessionRepository } from "./auth-session.repository.ts";
import type { CliDeviceSessionRepository } from "./cli-device-session.repository.ts";
import type { SignInAttemptLockRepository } from "./sign-in-attempt-lock.repository.ts";
import type { SignInSecuritySettingsRepository } from "./sign-in-security-settings.repository.ts";
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
  /** The rules organizations set over their members' sign-ins (GAC-09, GAC-10). */
  readonly signInSecurity: SignInSecuritySettingsRepository;
}
