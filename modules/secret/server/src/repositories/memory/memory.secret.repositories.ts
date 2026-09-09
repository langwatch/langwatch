import type { SecretRepositories } from "../secret.repositories.ts";
import { MemorySecretRepository } from "./memory.secret.repository.ts";

export class MemorySecretRepositories {
  static readonly requires = [] as const;

  static create(): SecretRepositories {
    return { secrets: MemorySecretRepository.create() };
  }
}
