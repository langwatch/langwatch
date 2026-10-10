import type { OneTimeRevealRepository } from "./one-time-reveal.repository.ts";
import type { SecretRepository } from "./secret.repository.ts";

/** The process's cipher; the key never reaches this package. */
export type SecretCipher = Readonly<{
  encrypt(value: string): string;
  decrypt(value: string): string;
}>;

export interface SecretRepositories {
  readonly secrets: SecretRepository;
  /** Short-lived parked secrets, served once (GAC-14). */
  readonly reveals: OneTimeRevealRepository;
}
