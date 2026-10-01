import type { SecretRepositories } from "../secret.repositories.ts";
import { MemoryOneTimeRevealRepository } from "./memory.one-time-reveal.repository.ts";
import { MemorySecretRepository } from "./memory.secret.repository.ts";

export class MemorySecretRepositories {
  static readonly requires = [] as const;

  static create(): SecretRepositories {
    return {
      secrets: MemorySecretRepository.create(),
      reveals: MemoryOneTimeRevealRepository.create(),
    };
  }
}
