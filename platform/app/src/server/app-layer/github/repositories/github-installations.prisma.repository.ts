import { Prisma, type PrismaClient } from "~/generated/prisma/client";

import type {
  GithubInstallationRow,
  GithubInstallationsRepository,
  GithubRepositoryRef,
  UpsertGithubInstallationInput,
} from "./github-installations.repository";

function parseRepositories(
  value: Prisma.JsonValue | null,
): GithubRepositoryRef[] | null {
  if (!Array.isArray(value)) return null;
  const refs: GithubRepositoryRef[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).id === "string" &&
      typeof (entry as Record<string, unknown>).fullName === "string"
    ) {
      refs.push({
        id: (entry as { id: string }).id,
        fullName: (entry as { fullName: string }).fullName,
      });
    }
  }
  return refs;
}

type InstallationRecord = {
  installationId: string;
  organizationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  repositorySelection: string;
  repositories: Prisma.JsonValue | null;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRow(record: InstallationRecord): GithubInstallationRow {
  return {
    installationId: record.installationId,
    organizationId: record.organizationId,
    accountLogin: record.accountLogin,
    accountType: record.accountType,
    accountId: record.accountId,
    repositorySelection: record.repositorySelection,
    repositories: parseRepositories(record.repositories),
    suspendedAt: record.suspendedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function reposToJson(
  repositories: GithubRepositoryRef[] | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!repositories) return Prisma.DbNull;
  return repositories as unknown as Prisma.InputJsonValue;
}

export class PrismaGithubInstallationsRepository
  implements GithubInstallationsRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAllForOrganization(
    organizationId: string,
  ): Promise<GithubInstallationRow[]> {
    const records = await this.prisma.githubInstallation.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    return records.map(toRow);
  }

  async findByInstallationId(
    installationId: string,
  ): Promise<GithubInstallationRow | null> {
    const record = await this.prisma.githubInstallation.findUnique({
      where: { installationId },
    });
    return record ? toRow(record) : null;
  }

  async upsert(input: UpsertGithubInstallationInput): Promise<void> {
    const repositories = reposToJson(input.repositories);
    await this.prisma.githubInstallation.upsert({
      where: { installationId: input.installationId },
      create: {
        installationId: input.installationId,
        organizationId: input.organizationId,
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        accountId: input.accountId,
        repositorySelection: input.repositorySelection,
        repositories,
        suspendedAt: null,
      },
      update: {
        organizationId: input.organizationId,
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        accountId: input.accountId,
        repositorySelection: input.repositorySelection,
        repositories,
      },
    });
  }

  async insertOrGetExisting(
    input: UpsertGithubInstallationInput,
  ): Promise<{ wasInserted: boolean; row: GithubInstallationRow }> {
    try {
      const created = await this.prisma.githubInstallation.create({
        data: {
          installationId: input.installationId,
          organizationId: input.organizationId,
          accountLogin: input.accountLogin,
          accountType: input.accountType,
          accountId: input.accountId,
          repositorySelection: input.repositorySelection,
          repositories: reposToJson(input.repositories),
          suspendedAt: null,
        },
      });
      return { wasInserted: true, row: toRow(created) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Another request already committed this installationId first — the
        // unique index is the atomicity guarantee, not a check we ran
        // ourselves, so this read always sees the winner's committed row.
        const existing = await this.prisma.githubInstallation.findUnique({
          where: { installationId: input.installationId },
        });
        if (existing) return { wasInserted: false, row: toRow(existing) };
      }
      throw error;
    }
  }

  async setRepositories({
    installationId,
    repositorySelection,
    repositories,
  }: {
    installationId: string;
    repositorySelection: string;
    repositories: GithubRepositoryRef[] | null;
  }): Promise<void> {
    await this.prisma.githubInstallation.updateMany({
      where: { installationId },
      data: {
        repositorySelection,
        repositories: reposToJson(repositories),
      },
    });
  }

  async setSuspended({
    installationId,
    suspended,
  }: {
    installationId: string;
    suspended: boolean;
  }): Promise<void> {
    await this.prisma.githubInstallation.updateMany({
      where: { installationId },
      data: { suspendedAt: suspended ? new Date() : null },
    });
  }

  async deleteByInstallationId(installationId: string): Promise<number> {
    const result = await this.prisma.githubInstallation.deleteMany({
      where: { installationId },
    });
    return result.count;
  }

  async isOrganizationMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    return membership !== null;
  }
}
