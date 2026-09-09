import type { AuthRepositories } from "../auth.repositories.ts";
import { MemoryAuthDatabase } from "./memory.auth.database.ts";
import { MemoryAuthSessionRepository } from "./memory.auth-session.repository.ts";
import { MemorySignUpVerificationTokenRepository } from "./memory.signup-verification-token.repository.ts";

/** Both twins over ONE store, so a session written here is read back here. */
export class MemoryAuthRepositories {
  static readonly requires = [] as const;

  static create(): AuthRepositories {
    const memory = MemoryAuthDatabase.create();

    return {
      sessions: MemoryAuthSessionRepository.create({ memory }),
      signUpTokens: MemorySignUpVerificationTokenRepository.create({ memory }),
    };
  }
}
