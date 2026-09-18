import type { UserRepositories } from "../user.repositories.ts";
import { MemoryUserDatabase } from "./memory.user.database.ts";
import { MemoryUserRepository } from "./memory.user.repository.ts";
import { MemoryUserCredentialRepository } from "./memory.user-signin-credential.repository.ts";

export class MemoryUserRepositories {
  static readonly requires = [] as const;

  static create(): UserRepositories {
    const database = MemoryUserDatabase.create();

    return {
      users: MemoryUserRepository.create({ database }),
      credentials: MemoryUserCredentialRepository.create({ database }),
    };
  }
}
