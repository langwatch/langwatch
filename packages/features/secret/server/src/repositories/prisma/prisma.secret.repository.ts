import {
  SecretDuplicateError,
  SecretNotFoundError,
  secretSchema,
  type Secret,
} from "@langwatch/secret-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { SecretRepository } from "../secret.repository";

const safeSecretSelection = {
  id: true,
  projectId: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} as const;

export class PrismaSecretRepository extends SecretRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: object): PrismaSecretRepository {
    return new PrismaSecretRepository(database as PrismaClient);
  }

  async list(projectId: string): Promise<Secret[]> {
    const rows = await this.database.projectSecret.findMany({
      where: { projectId },
      select: safeSecretSelection,
      orderBy: { name: "asc" },
    });
    return rows.map((row) => secretSchema.parse(row));
  }

  async get(projectId: string, id: string): Promise<Secret> {
    const row = await this.database.projectSecret.findFirst({
      where: { id, projectId },
      select: safeSecretSelection,
    });
    if (!row) throw new SecretNotFoundError();
    return secretSchema.parse(row);
  }

  count(projectId: string): Promise<number> {
    return this.database.projectSecret.count({ where: { projectId } });
  }

  async create(input: {
    projectId: string;
    name: string;
    encryptedValue: string;
    actorId: string;
  }): Promise<Secret> {
    try {
      return secretSchema.parse(
        await this.database.projectSecret.create({
          data: {
            projectId: input.projectId,
            name: input.name,
            encryptedValue: input.encryptedValue,
            createdById: input.actorId,
            updatedById: input.actorId,
          },
          select: safeSecretSelection,
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new SecretDuplicateError(input.name);
      }
      throw error;
    }
  }

  async update(input: {
    projectId: string;
    id: string;
    encryptedValue: string;
    actorId: string;
  }): Promise<Secret> {
    try {
      return secretSchema.parse(
        await this.database.projectSecret.update({
          where: { id: input.id, projectId: input.projectId },
          data: {
            encryptedValue: input.encryptedValue,
            updatedById: input.actorId,
          },
          select: safeSecretSelection,
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new SecretNotFoundError();
      }
      throw error;
    }
  }

  async delete(projectId: string, id: string): Promise<void> {
    try {
      await this.database.projectSecret.delete({ where: { id, projectId } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new SecretNotFoundError();
      }
      throw error;
    }
  }
}
