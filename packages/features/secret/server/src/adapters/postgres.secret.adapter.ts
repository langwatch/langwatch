import type { SecretService as SecretServiceContract } from "@langwatch/secret-contract";
import type { SecretEncryptionPort } from "../ports/secret.port";
import { PrismaSecretRepository } from "../repositories/prisma/prisma.secret.repository";
import { SecretService } from "../services/secret.service";

export interface PostgresSecretAdapterOptions {
  database: object;
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
