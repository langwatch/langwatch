import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  RevealedSecret,
  RevealOnceInput,
  StashedReveal,
  StashRevealInput,
} from "./one-time-reveal.ts";
import type {
  CreateSecretInput,
  DeleteSecretInput,
  GetSecretInput,
  ListSecretsInput,
  Secret,
  UpdateSecretInput,
} from "./secret.ts";
export interface SecretCaller {
  readonly id: string;
}

export interface SecretApi {
  list(input: ListSecretsInput): Promise<Secret[]>;
  get(input: GetSecretInput): Promise<Secret>;
  getValues(input: ListSecretsInput): Promise<Record<string, string>>;
  delete(input: DeleteSecretInput): Promise<void>;
  /** With no caller, the write is attributed to the first member of the project's team. */
  create(input: Omit<CreateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret>;
  /** With no caller, the write is attributed to the first member of the project's team. */
  update(input: Omit<UpdateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret>;
  /** Parks a secret for a single later read, and answers the id that reads it. */
  stashReveal(input: StashRevealInput): Promise<StashedReveal>;
  /** Serves a stashed secret and forgets it. Every later read is refused. */
  revealOnce(input: RevealOnceInput): Promise<RevealedSecret>;
}

export const SecretApi = moduleApi<SecretApi>()("secret");
