import type { AuthRepositories } from "../auth.repositories.ts";
import { MemoryAuthRateLimitRepository } from "./memory.auth-rate-limit.repository.ts";
import { MemoryAuthSessionRepository } from "./memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "./memory.auth.database.ts";
import { MemoryCliDeviceSessionRepository } from "./memory.cli-device-session.repository.ts";
import { MemorySignInAttemptLockRepository } from "./memory.sign-in-attempt-lock.repository.ts";
import { MemorySignInSecuritySettingsRepository } from "./memory.sign-in-security-settings.repository.ts";
import { MemorySignUpVerificationTokenRepository } from "./memory.signup-verification-token.repository.ts";

/** Both twins over ONE store, so a session written here is read back here. */
export class MemoryAuthRepositories {
  static readonly requires = [] as const;

  static create(): MemoryAuthRepositories {
    const memory = MemoryAuthDatabase.create();

    return new MemoryAuthRepositories(memory);
  }

  readonly sessions: AuthRepositories["sessions"];
  readonly cliSessions: MemoryCliDeviceSessionRepository;
  readonly signUpTokens: AuthRepositories["signUpTokens"];
  readonly signInLocks: MemorySignInAttemptLockRepository;
  readonly signInSecurity: MemorySignInSecuritySettingsRepository;
  readonly rateLimits: MemoryAuthRateLimitRepository;

  private constructor(memory: MemoryAuthDatabase) {
    this.sessions = MemoryAuthSessionRepository.create({ memory });
    this.cliSessions = MemoryCliDeviceSessionRepository.create();
    this.signUpTokens = MemorySignUpVerificationTokenRepository.create({ memory });
    this.signInLocks = MemorySignInAttemptLockRepository.create();
    this.signInSecurity = MemorySignInSecuritySettingsRepository.create();
    this.rateLimits = MemoryAuthRateLimitRepository.create();
  }
}
