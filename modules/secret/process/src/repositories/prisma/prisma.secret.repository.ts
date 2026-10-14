import { PrismaRepository, type PrismaRepositoryClient } from "@langwatch/prisma-client";
import { isRecordNotFoundError, isUniqueConstraintError } from "@langwatch/prisma-client/errors";
import { SecretDuplicateError, SecretNotFoundError, type Secret } from "@langwatch/secret-contract";

import type { SecretCipher } from "../secret.repositories.ts";
import type {
  CreateStoredSecretInput,
  SecretIdentity,
  NamedSecretsScope,
  OpenedSecretValue,
  SecretProjectScope,
  SecretRepository,
  UpdateStoredSecretInput,
} from "../secret.repository.ts";

/** Metadata only: the encrypted column is absent from every read but one. */
const safeSecretSelect = {
  id: true,
  projectId: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} as const;

/** The value rests sealed in `encryptedValue`; a row the cipher refuses reads as unreadable. */
function opened(cipher: SecretCipher, row: { name: string; encryptedValue: string }) {
  try {
    return { name: row.name, readable: true, value: cipher.decrypt(row.encryptedValue) } as const;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { name: row.name, readable: false, reason } as const;
  }
}

export type SecretDatabase = PrismaRepositoryClient<readonly ["ProjectSecret"]>;

export class PrismaSecretRepository
  extends PrismaRepository.for("ProjectSecret")
  implements SecretRepository
{
  static create(input: { prisma: SecretDatabase; cipher: SecretCipher }): PrismaSecretRepository {
    return new PrismaSecretRepository(input.prisma, input.cipher);
  }

  readonly #cipher: SecretCipher;

  private constructor(prisma: SecretDatabase, cipher: SecretCipher) {
    super(prisma);
    this.#cipher = cipher;
  }

  async findAll(input: SecretProjectScope): Promise<Secret[]> {
    const rows = await this.prisma.projectSecret.findMany({
      where: { projectId: input.projectId },
      select: safeSecretSelect,
      orderBy: { name: "asc" },
    });

    return rows;
  }

  async findAllValues(input: SecretProjectScope): Promise<OpenedSecretValue[]> {
    const rows = await this.prisma.projectSecret.findMany({
      where: { projectId: input.projectId },
      select: { name: true, encryptedValue: true },
    });

    return rows.map((row) => opened(this.#cipher, row));
  }

  async findValuesByName(input: NamedSecretsScope): Promise<OpenedSecretValue[]> {
    const rows = await this.prisma.projectSecret.findMany({
      where: { projectId: input.projectId, name: { in: [...input.names] } },
      select: { name: true, encryptedValue: true },
    });

    return rows.map((row) => opened(this.#cipher, row));
  }

  async findById(input: SecretIdentity): Promise<Secret | undefined> {
    const row = await this.prisma.projectSecret.findFirst({
      where: { id: input.id, projectId: input.projectId },
      select: safeSecretSelect,
    });

    return row ?? undefined;
  }

  count(input: SecretProjectScope): Promise<number> {
    return this.prisma.projectSecret.count({ where: { projectId: input.projectId } });
  }

  async create(input: CreateStoredSecretInput): Promise<Secret> {
    try {
      const row = await this.prisma.projectSecret.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          encryptedValue: this.#cipher.encrypt(input.value),
          createdById: input.actorId,
          updatedById: input.actorId,
        },
        select: safeSecretSelect,
      });

      return row;
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new SecretDuplicateError(input.name);

      throw error;
    }
  }

  async update(input: UpdateStoredSecretInput): Promise<Secret> {
    try {
      const row = await this.prisma.projectSecret.update({
        where: { id: input.id, projectId: input.projectId },
        data: {
          encryptedValue: this.#cipher.encrypt(input.value),
          updatedById: input.actorId,
        },
        select: safeSecretSelect,
      });

      return row;
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new SecretNotFoundError();

      throw error;
    }
  }

  async delete(input: SecretIdentity): Promise<void> {
    try {
      await this.prisma.projectSecret.delete({
        where: { id: input.id, projectId: input.projectId },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new SecretNotFoundError();

      throw error;
    }
  }
}
