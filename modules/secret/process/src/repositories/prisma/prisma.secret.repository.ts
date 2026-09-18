import { PrismaRepository } from "@langwatch/prisma-client";
import { isRecordNotFoundError, isUniqueConstraintError } from "@langwatch/prisma-client/errors";
import {
  SecretDuplicateError,
  SecretNotFoundError,
  secretSchema,
  type Secret,
} from "@langwatch/secret-contract";
import type {
  CreateStoredSecretInput,
  SecretIdentity,
  SecretProjectScope,
  SecretRepository,
  StoredSecretValue,
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

export class PrismaSecretRepository
  extends PrismaRepository.for("ProjectSecret")
  implements SecretRepository
{
  static readonly create = this.factory((prisma) => new PrismaSecretRepository(prisma));

  async findAll(input: SecretProjectScope): Promise<Secret[]> {
    const rows = await this.prisma.projectSecret.findMany({
      where: { projectId: input.projectId },
      select: safeSecretSelect,
      orderBy: { name: "asc" },
    });

    return rows.map((row) => secretSchema.parse(row));
  }

  findAllValues(input: SecretProjectScope): Promise<StoredSecretValue[]> {
    return this.prisma.projectSecret.findMany({
      where: { projectId: input.projectId },
      select: { name: true, encryptedValue: true },
    });
  }

  async findById(input: SecretIdentity): Promise<Secret | undefined> {
    const row = await this.prisma.projectSecret.findFirst({
      where: { id: input.id, projectId: input.projectId },
      select: safeSecretSelect,
    });

    return row ? secretSchema.parse(row) : undefined;
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
          encryptedValue: input.encryptedValue,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
        select: safeSecretSelect,
      });

      return secretSchema.parse(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new SecretDuplicateError(input.name);

      throw error;
    }
  }

  async update(input: UpdateStoredSecretInput): Promise<Secret> {
    try {
      const row = await this.prisma.projectSecret.update({
        where: { id: input.id, projectId: input.projectId },
        data: { encryptedValue: input.encryptedValue, updatedById: input.actorId },
        select: safeSecretSelect,
      });

      return secretSchema.parse(row);
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
