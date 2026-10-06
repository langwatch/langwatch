import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectNotFoundError } from "@langwatch/project-contract";

import type {
  ProjectStorageCipher,
  ProjectStorageSettings,
  ProjectStorageSettingsRepository,
} from "../project-storage-settings.repository.ts";

export type PrismaProjectStorageDatabase = Pick<PrismaClient, "project">;

export class PrismaProjectStorageSettingsRepository
  extends PrismaRepository.for("Project")
  implements ProjectStorageSettingsRepository
{
  readonly #cipher: ProjectStorageCipher;

  private constructor(prisma: PrismaProjectStorageDatabase, cipher: ProjectStorageCipher) {
    super(prisma);
    this.#cipher = cipher;
  }

  static create({
    prisma,
    cipher,
  }: {
    prisma: PrismaProjectStorageDatabase;
    cipher: ProjectStorageCipher;
  }): PrismaProjectStorageSettingsRepository {
    return new PrismaProjectStorageSettingsRepository(prisma, cipher);
  }

  async update({
    projectId,
    organizationId,
    settings,
  }: {
    projectId: string;
    organizationId: string;
    settings: ProjectStorageSettings;
  }): Promise<ProjectStorageSettings> {
    const stored: ProjectStorageSettings = {
      ...(settings.s3Endpoint !== undefined && { s3Endpoint: this.#seal(settings.s3Endpoint) }),
      ...(settings.s3AccessKeyId !== undefined && {
        s3AccessKeyId: this.#seal(settings.s3AccessKeyId),
      }),
      ...(settings.s3SecretAccessKey !== undefined && {
        s3SecretAccessKey: this.#seal(settings.s3SecretAccessKey),
      }),
      ...(settings.s3Bucket !== undefined && { s3Bucket: settings.s3Bucket }),
    };
    const result = await this.prisma.project.updateMany({
      where: { id: projectId, archivedAt: null, team: { organizationId } },
      data: stored,
    });
    if (result.count === 0) throw new ProjectNotFoundError("Project not found");

    return stored;
  }

  #seal(value: string | null): string | null {
    return value === null ? null : this.#cipher.encrypt(value);
  }
}
