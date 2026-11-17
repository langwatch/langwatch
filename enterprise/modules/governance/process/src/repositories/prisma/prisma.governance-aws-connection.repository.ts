// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceAwsConnectionNotFoundError } from "@langwatch/enterprise-governance-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";

import {
  type GovernanceAwsConnectionRecord,
  GovernanceAwsConnectionRepository,
  type GovernanceAwsCredentials,
} from "../governance-aws-connection.repository.ts";

type AwsConnectionDatabase = Pick<PrismaClient, "governanceAwsConnection">;

const RECORD_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  accessKeyId: true,
  roleArn: true,
  encryptedExternalId: true,
  createdAt: true,
} as const;

function recordOf(row: {
  id: string;
  organizationId: string;
  name: string;
  accessKeyId: string | null;
  roleArn: string | null;
  encryptedExternalId: string | null;
  createdAt: Date;
}): GovernanceAwsConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    accessKeyId: row.accessKeyId,
    roleArn: row.roleArn,
    hasExternalId: row.encryptedExternalId !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Seals the secret access key and the external id under the process cipher (CREDENTIALS_SECRET). */
export class PrismaGovernanceAwsConnectionRepository extends GovernanceAwsConnectionRepository {
  private constructor(
    private readonly prisma: AwsConnectionDatabase,
    private readonly cipher: Encryption,
  ) {
    super();
  }

  static create({
    database,
    cipher,
  }: {
    database: AwsConnectionDatabase;
    cipher: Encryption;
  }): PrismaGovernanceAwsConnectionRepository {
    return new PrismaGovernanceAwsConnectionRepository(database, cipher);
  }

  async create(input: {
    id: string;
    organizationId: string;
    name: string;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    roleArn: string | null;
    externalId: string | null;
  }): Promise<GovernanceAwsConnectionRecord> {
    const row = await this.prisma.governanceAwsConnection.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        accessKeyId: input.accessKeyId,
        encryptedSecretAccessKey:
          input.secretAccessKey === null ? null : this.cipher.encrypt(input.secretAccessKey),
        roleArn: input.roleArn,
        encryptedExternalId:
          input.externalId === null ? null : this.cipher.encrypt(input.externalId),
      },
      select: RECORD_SELECT,
    });
    return recordOf(row);
  }

  async findAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GovernanceAwsConnectionRecord[]> {
    const rows = await this.prisma.governanceAwsConnection.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: RECORD_SELECT,
    });
    return rows.map(recordOf);
  }

  async findByIds({
    organizationId,
    ids,
  }: {
    organizationId: string;
    ids: readonly string[];
  }): Promise<GovernanceAwsConnectionRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.governanceAwsConnection.findMany({
      where: { organizationId, id: { in: [...ids] } },
      select: RECORD_SELECT,
    });
    return rows.map(recordOf);
  }

  async getCredentials({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<GovernanceAwsCredentials> {
    const row = await this.prisma.governanceAwsConnection.findFirst({
      where: { organizationId, id },
      select: {
        accessKeyId: true,
        encryptedSecretAccessKey: true,
        roleArn: true,
        encryptedExternalId: true,
      },
    });
    if (!row) throw new GovernanceAwsConnectionNotFoundError(id);
    return {
      accessKeyId: row.accessKeyId,
      secretAccessKey:
        row.encryptedSecretAccessKey === null
          ? null
          : this.cipher.decrypt(row.encryptedSecretAccessKey),
      roleArn: row.roleArn,
      externalId:
        row.encryptedExternalId === null ? null : this.cipher.decrypt(row.encryptedExternalId),
    };
  }

  async delete({ organizationId, id }: { organizationId: string; id: string }): Promise<boolean> {
    const { count } = await this.prisma.governanceAwsConnection.deleteMany({
      where: { organizationId, id },
    });
    return count > 0;
  }
}
