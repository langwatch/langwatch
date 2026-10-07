import type { AuthRepositories } from "../auth.repositories.ts";
import { MemoryAuthDirectoryRepository } from "./memory.auth-directory.repository.ts";
import { MemoryAuthRateLimitRepository } from "./memory.auth-rate-limit.repository.ts";
import { MemoryAuthSessionRepository } from "./memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "./memory.auth.database.ts";
import { MemoryBetterAuthHooksRepository } from "./memory.better-auth-hooks.repository.ts";
import { MemoryBetterAuthMapSecondaryStorageRepository } from "./memory.better-auth-map-secondary-storage.repository.ts";
import { MemoryBetterAuthStorageRepository } from "./memory.better-auth-storage.repository.ts";
import { MemoryCliDeviceSessionRepository } from "./memory.cli-device-session.repository.ts";
import { MemorySignInAttemptLockRepository } from "./memory.sign-in-attempt-lock.repository.ts";
import { MemorySignUpVerificationTokenRepository } from "./memory.signup-verification-token.repository.ts";

/** Every twin over ONE store, so a row Better Auth writes here is read back here. */
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
  readonly rateLimits: MemoryAuthRateLimitRepository;
  readonly betterAuthStorage: MemoryBetterAuthStorageRepository;
  readonly betterAuthSecondaryStorage: AuthRepositories["betterAuthSecondaryStorage"];
  readonly betterAuthHooks: MemoryBetterAuthHooksRepository;
  readonly directory: MemoryAuthDirectoryRepository;

  private constructor(memory: MemoryAuthDatabase) {
    this.sessions = MemoryAuthSessionRepository.create({ memory });
    this.cliSessions = MemoryCliDeviceSessionRepository.create();
    this.signUpTokens = MemorySignUpVerificationTokenRepository.create({ memory });
    this.signInLocks = MemorySignInAttemptLockRepository.create();
    this.rateLimits = MemoryAuthRateLimitRepository.create();
    this.betterAuthStorage = MemoryBetterAuthStorageRepository.create({ memory });
    this.betterAuthSecondaryStorage = MemoryBetterAuthMapSecondaryStorageRepository.create();
    this.betterAuthHooks = MemoryBetterAuthHooksRepository.create({ memory });
    this.directory = MemoryAuthDirectoryRepository.create({ memory });
  }
}
