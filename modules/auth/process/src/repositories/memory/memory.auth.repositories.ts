import type { AuthRepositories } from "../auth.repositories.ts";
import { MemoryAuthSessionRepository } from "./memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "./memory.auth.database.ts";
import { MemoryCliDeviceSessionRepository } from "./memory.cli-device-session.repository.ts";
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

  private constructor(memory: MemoryAuthDatabase) {
    this.sessions = MemoryAuthSessionRepository.create({ memory });
    this.cliSessions = MemoryCliDeviceSessionRepository.create();
    this.signUpTokens = MemorySignUpVerificationTokenRepository.create({ memory });
  }
}
