import type { IdentityStorageAdapterInput } from "@langwatch/identity-contract";
import { UserNotFoundError } from "@langwatch/user-contract";
import { memoryAdapter } from "better-auth/adapters/memory";

import type { AuthDirectoryRepository } from "../auth-directory.repository.ts";
import type { AuthRepositories } from "../auth.repositories.ts";
import { BetterAuthStorageRepository } from "../better-auth-storage.repository.ts";
import { MemoryAuthRateLimitRepository } from "./memory.auth-rate-limit.repository.ts";
import { MemoryAuthSessionRepository } from "./memory.auth-session.repository.ts";
import { MemoryAuthDatabase, type MemoryUserRow } from "./memory.auth.database.ts";
import { MemoryBetterAuthHooksRepository } from "./memory.better-auth-hooks.repository.ts";
import { MemoryBetterAuthMapSecondaryStorageRepository } from "./memory.better-auth-map-secondary-storage.repository.ts";
import { MemoryCliDeviceSessionRepository } from "./memory.cli-device-session.repository.ts";
import { MemoryPendingSsoSetupRepository } from "./memory.pending-sso-setup.repository.ts";
import { MemorySignInAttemptLockRepository } from "./memory.sign-in-attempt-lock.repository.ts";
import { MemorySignUpVerificationTokenRepository } from "./memory.signup-verification-token.repository.ts";

/** The memory twin of the person a device grant names. */
class MemoryAuthDirectoryRepository implements AuthDirectoryRepository {
  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryAuthDirectoryRepository {
    return new MemoryAuthDirectoryRepository(memory);
  }

  private constructor(private readonly memory: MemoryAuthDatabase) {}

  async getPerson(
    userId: string,
  ): Promise<{ id: string; email: string | null; name: string | null }> {
    const person = (this.memory.db.User as MemoryUserRow[]).find((row) => row.id === userId);
    if (person === undefined) throw new UserNotFoundError(userId);
    return { id: person.id, email: person.email ?? null, name: person.name ?? null };
  }
}

/** Better Auth's own memory adapter over auth's memory database, so the memory
 *  tier signs in against the rows its twins read. It has no transactions, so
 *  the "transaction" runs the work over the same engine. */
class MemoryBetterAuthStorageRepository extends BetterAuthStorageRepository {
  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryBetterAuthStorageRepository {
    return new MemoryBetterAuthStorageRepository(memory);
  }

  private constructor(private readonly memory: MemoryAuthDatabase) {
    super();
  }

  engines(): IdentityStorageAdapterInput {
    const legacyEngine = memoryAdapter(this.memory.db);
    return { legacyEngine, postgresTransaction: (work) => work(legacyEngine) };
  }
}

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
  readonly pendingSsoSetup: MemoryPendingSsoSetupRepository;
  readonly sessionCache = null;

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
    this.pendingSsoSetup = MemoryPendingSsoSetupRepository.create();
  }
}
