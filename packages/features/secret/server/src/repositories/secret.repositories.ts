import type { SecretRepository } from "./secret.repository.ts";

export interface SecretRepositories {
  readonly secrets: SecretRepository;
}
