import type { BetterAuthOptions } from "better-auth";

import type { AuthDirectoryRepository } from "./auth-directory.repository.ts";
import type { AuthRateLimitRepository } from "./auth-rate-limit.repository.ts";
import type { AuthSessionRepository } from "./auth-session.repository.ts";
import type { BetterAuthHooksRepository } from "./better-auth-hooks.repository.ts";
import type { BetterAuthStorageRepository } from "./better-auth-storage.repository.ts";
import type { CliDeviceSessionRepository } from "./cli-device-session.repository.ts";
import type { SignInAttemptLockRepository } from "./sign-in-attempt-lock.repository.ts";
import type { SignUpVerificationTokenRepository } from "./signup-verification.repository.ts";

/**
 * Auth's browser-session rows, signup confirmation tokens, TTL'd CLI device
 * sessions, the sign-in security rules and counters, and Better Auth's storage.
 * Everything else it reads belongs to another module and arrives as a peer.
 */
export interface AuthRepositories {
  readonly sessions: AuthSessionRepository;
  readonly cliSessions: CliDeviceSessionRepository;
  readonly signUpTokens: SignUpVerificationTokenRepository;
  /** The consecutive-failure counter behind account lock-out (GAC-09). */
  readonly signInLocks: SignInAttemptLockRepository;
  /** The sign-in door's and the token check's fixed-window counters. */
  readonly rateLimits: AuthRateLimitRepository;
  /** The adapter Better Auth is handed: one tier's own tables (ARCHITECTURE.md 3.2). */
  readonly betterAuthStorage: BetterAuthStorageRepository;
  /** Better Auth's session cache and rate-limit counters. */
  readonly betterAuthSecondaryStorage: NonNullable<BetterAuthOptions["secondaryStorage"]>;
  /** The `User` and `Account` rows Better Auth's database hooks read and write. */
  readonly betterAuthHooks: BetterAuthHooksRepository;
  /** The person a CLI device grant names. */
  readonly directory: AuthDirectoryRepository;
}
