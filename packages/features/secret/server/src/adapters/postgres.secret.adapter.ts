import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretService as SecretServiceContract } from "@langwatch/secret-contract";
import type { SecretEncryptionPort } from "../ports/secret.port";
import { PrismaSecretRepository } from "../repositories/prisma/prisma.secret.repository";
import { SecretService } from "../services/secret.service";

export interface PostgresSecretAdapterOptions {
  /**
   * The composition root's own guarded client, typed.
   *
   * It used to arrive as `object` and be cast back to a `PrismaClient` at the
   * repository, which let any caller hand in something that was not a client
   * at all and find out on the first query. Both processes that compose this
   * adapter already hold the typed client, so nothing was gained by throwing
   * the type away between them.
   */
  database: PrismaClient;
  encryption: SecretEncryptionPort;
  reservedNames: readonly string[];
  maximumPerProject?: number;
}

export class PostgresSecretAdapter {
  private readonly repository: PrismaSecretRepository;
  private service: SecretServiceContract | null = null;

  private constructor(private readonly options: PostgresSecretAdapterOptions) {
    this.repository = PrismaSecretRepository.create(options.database);
  }

  static create(options: PostgresSecretAdapterOptions): PostgresSecretAdapter {
    return new PostgresSecretAdapter(options);
  }

  build(): SecretServiceContract {
    if (this.service) return this.service;

    this.service = SecretService.create({
      repository: this.repository,
      encryption: this.options.encryption,
      reservedNames: this.options.reservedNames,
      maximumPerProject: this.options.maximumPerProject,
    });
    return this.service;
  }
}
