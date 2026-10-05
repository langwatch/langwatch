import { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/process";
/** The secret feature application shared by all transports. */
import { type MembersRead } from "@langwatch/process-stores/members";
import {
  RESERVED_PROJECT_SECRET_NAMES,
  SecretApi,
  type RevealedSecret,
  type RevealOnceInput,
  type StashedReveal,
  type StashRevealInput,
  type CreateReservedSecretInput,
  type CreateSecretInput,
  type DeleteSecretInput,
  type GetSecretInput,
  type GetSecretValuesByNameInput,
  type ListSecretsInput,
  type Secret,
  type SecretApi as SecretApiContract,
  type SecretCaller,
  type UpdateSecretInput,
} from "@langwatch/secret-contract";

import type { SecretRepositories } from "../repositories/secret.repositories.ts";
import { OneTimeRevealService } from "../services/one-time-reveal.service.ts";
import { SecretService } from "../services/secret.service.ts";

/**
 * The cipher is the process's own `encryption` member; the key never reaches
 * this package, and a deployment that configured none refuses at boot naming
 * this module rather than storing a project's value in the clear.
 */
type SecretSetup = FeatureSetup<
  typeof SecretModule.dependencies,
  MembersRead<typeof SecretModule.reads>,
  undefined,
  SecretRepositories
>;

export class SecretModule implements SecretApiContract {
  static readonly contract = SecretApi;
  static readonly dependencies = { permissions: AuthzApi };
  static readonly reads = ["encryption"] as const;

  #secrets: SecretService;
  #reveals: OneTimeRevealService;

  private constructor(secrets: SecretService, reveals: OneTimeRevealService) {
    this.#secrets = secrets;
    this.#reveals = reveals;
  }

  static create(setup: SecretSetup): SecretModule {
    return new SecretModule(
      SecretService.create({
        repository: setup.repositories.secrets,
        encryption: setup.members.encryption,
        reservedNames: RESERVED_PROJECT_SECRET_NAMES,
        permissions: setup.dependencies.permissions,
      }),
      OneTimeRevealService.create({
        store: setup.repositories.reveals,
        encryption: setup.members.encryption,
      }),
    );
  }

  /** Parks a secret for a single later read, and answers the id that reads it. */
  stashReveal(input: StashRevealInput): Promise<StashedReveal> {
    return this.#reveals.stash(input);
  }

  /** Serves a stashed secret and forgets it. Every later read is refused. */
  revealOnce(input: RevealOnceInput): Promise<RevealedSecret> {
    return this.#reveals.reveal(input);
  }

  /** The project's secrets, metadata only. */
  list(input: ListSecretsInput): Promise<Secret[]> {
    return this.#secrets.list(input);
  }

  /** One secret's metadata. */
  get(input: GetSecretInput): Promise<Secret> {
    return this.#secrets.get(input);
  }

  /** Every stored value, decrypted, for a process that runs on them. */
  getValues(input: ListSecretsInput): Promise<Record<string, string>> {
    return this.#secrets.getValues(input);
  }

  /** Only the named values, decrypted; a reserved name is never among them. */
  getValuesByName(input: GetSecretValuesByNameInput): Promise<Record<string, string>> {
    return this.#secrets.getValuesByName(input);
  }

  /** Removes one secret from the project. */
  delete(input: DeleteSecretInput): Promise<void> {
    return this.#secrets.delete(input);
  }

  /** Stores a new secret, attributed to the caller, or to the team's first member without one. */
  create(input: Omit<CreateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret> {
    return this.#secrets.create(input, by);
  }

  /** Replaces a secret's value, attributed as `create` attributes. */
  update(input: Omit<UpdateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret> {
    return this.#secrets.update(input, by);
  }

  /** Stores a reserved-name secret for its feature; a concurrent writer's value wins. */
  createReserved(input: CreateReservedSecretInput): Promise<{ value: string }> {
    return this.#secrets.createReserved(input);
  }
}

export interface SecretEncryption {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
