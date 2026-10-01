import type { OneTimeRevealRepository } from "./one-time-reveal.repository.ts";
import type { SecretRepository } from "./secret.repository.ts";

export interface SecretRepositories {
  readonly secrets: SecretRepository;
  /** Short-lived parked secrets, served once (GAC-14). */
  readonly reveals: OneTimeRevealRepository;
}
