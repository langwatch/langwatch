/** The secret feature application shared by all transports. */
import { reads, type MembersRead } from "@langwatch/infrastructure";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import {
  RESERVED_PROJECT_SECRET_NAMES,
  SecretApi,
  type CreateSecretInput,
  type DeleteSecretInput,
  type GetSecretInput,
  type ListSecretsInput,
  type Secret,
  type SecretApi as SecretApiContract,
  type SecretCaller,
  type UpdateSecretInput,
} from "@langwatch/secret-contract";
import type { SecretRepositories } from "../repositories/secret.repositories.ts";
import { SecretService } from "../services/secret.service.ts";

/**
 * The cipher is the process's own `encryption` member; the key never reaches
 * this package, and a deployment that configured none refuses at boot naming
 * this module rather than storing a project's value in the clear.
 */
type SecretSetup = FeatureSetup<
  typeof SecretApp.dependencies,
  MembersRead<typeof SecretApp.reads>,
  undefined,
  SecretRepositories
>;

export class SecretApp implements SecretApiContract {
  static readonly contract = SecretApi;
  static readonly dependencies = {};
  static readonly reads = reads("encryption");

  #secrets: SecretService;

  private constructor(secrets: SecretService) {
    this.#secrets = secrets;
  }

  static create(setup: SecretSetup): SecretApp {
    return new SecretApp(
      SecretService.create({
        repository: setup.repositories.secrets,
        encryption: setup.members.encryption,
        reservedNames: RESERVED_PROJECT_SECRET_NAMES,
      }),
    );
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

  /** Removes one secret from the project. */
  delete(input: DeleteSecretInput): Promise<void> {
    return this.#secrets.delete(input);
  }

  /**
   * Stores a new secret, attributed to the caller who asked for it. The
   * attribution is here rather than in each door: "who added this" is a
   * property of the act, not of the transport it arrived over.
   */
  create(input: Omit<CreateSecretInput, "actorId">, by: SecretCaller): Promise<Secret> {
    return this.#secrets.create({ ...input, actorId: by.id });
  }

  /** Replaces a secret's value, attributed to the caller who asked for it. */
  update(input: Omit<UpdateSecretInput, "actorId">, by: SecretCaller): Promise<Secret> {
    return this.#secrets.update({ ...input, actorId: by.id });
  }
}


export interface SecretEncryption {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
