import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ProjectStorageCipher } from "../project-storage-settings.repository.ts";
import type { ProjectRepositories } from "../project.repositories.ts";
import { PrismaProjectStorageSettingsRepository } from "./prisma.project-storage-settings.repository.ts";
import { PrismaProjectRepository } from "./prisma.project.repository.ts";

/**
 * The live tier: project rows in Postgres, and the stored-object columns of
 * those rows sealed with the deployment's cipher before they are written.
 */
export class PostgresProjectRepositories {
  static readonly requires = ["prisma", "encryption"] as const;
  static readonly repositories = {
    projects: { tables: PrismaProjectRepository.tables },
    storageSettings: { tables: PrismaProjectStorageSettingsRepository.tables },
  } as const;

  static create(
    members: Readonly<{ prisma: PrismaClient; encryption: ProjectStorageCipher }>,
  ): ProjectRepositories {
    return {
      projects: PrismaProjectRepository.create({ prisma: members.prisma }),
      storageSettings: PrismaProjectStorageSettingsRepository.create({
        prisma: members.prisma,
        cipher: members.encryption,
      }),
    };
  }
}
