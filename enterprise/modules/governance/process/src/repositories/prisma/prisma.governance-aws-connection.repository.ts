// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuditLogIntent } from "@langwatch/audit-log-contract";
import { GovernanceAwsConnectionNotFoundError } from "@langwatch/enterprise-governance-contract";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import { skipTenantCheck } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import { nowInstant } from "@langwatch/time";

import { awsConnectionsLockKey } from "../../features/kill-switch/rules/governance-aws-connection.rules.ts";
import { killSwitchAuditAppend } from "../../features/kill-switch/rules/kill-switch-audit.rules.ts";
import {
  type GovernanceAwsConnectionRecord,
  GovernanceAwsConnectionRepository,
  type GovernanceAwsCredentials,
} from "../governance-aws-connection.repository.ts";

type AwsConnectionDatabase = PrismaClient;

const RECORD_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  accessKeyId: true,
  roleArn: true,
  encryptedExternalId: true,
  createdAt: true,
} as const;

function recordOf(
  row: {
    id: string;
    organizationId: string;
    name: string;
    accessKeyId: string | null;
    roleArn: string | null;
    encryptedExternalId: string | null;
    createdAt: Date;
  },
  cipher: Encryption,
): GovernanceAwsConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    accessKeyId: row.accessKeyId,
    roleArn: row.roleArn,
    externalId: row.encryptedExternalId === null ? null : cipher.decrypt(row.encryptedExternalId),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Seals the secret access key and the external id under the process cipher (CREDENTIALS_SECRET).
 * A write and its audit intent share one transaction, as the organisation audit store does.
 */
export class PrismaGovernanceAwsConnectionRepository extends GovernanceAwsConnectionRepository {
  private constructor(
    private readonly prisma: AwsConnectionDatabase,
    private readonly cipher: Encryption,
  ) {
    super();
  }

  #outbox: PrismaProcessStore | undefined;

  private async appendAudit({
    audit,
    transaction,
  }: {
    audit: AuditLogIntent;
    transaction: Prisma.TransactionClient;
  }): Promise<void> {
    this.#outbox ??= PrismaProcessStore.create({ database: this.prisma });
    await this.#outbox.appendIntents({
      ...killSwitchAuditAppend(audit),
      now: nowInstant().epochMilliseconds,
      transaction,
    });
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
    audit: AuditLogIntent;
  }): Promise<GovernanceAwsConnectionRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.governanceAwsConnection.create({
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
      await this.appendAudit({ audit: input.audit, transaction });
      return recordOf(row, this.cipher);
    });
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
    return rows.map((row) => recordOf(row, this.cipher));
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
    return rows.map((row) => recordOf(row, this.cipher));
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

  async delete({
    organizationId,
    id,
    audit,
    whileLocked,
  }: {
    organizationId: string;
    id: string;
    audit: AuditLogIntent;
    whileLocked?: () => Promise<void>;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw` ${skipTenantCheck({
        // Advisory-lock helper, the key names one organisation's AWS connections.
        SKIP_TENANT_CHECK: true,
      })}
SELECT pg_advisory_xact_lock(hashtextextended(${awsConnectionsLockKey(organizationId)}, 0))`;
      await whileLocked?.();
      const { count } = await transaction.governanceAwsConnection.deleteMany({
        where: { organizationId, id },
      });
      if (count > 0) await this.appendAudit({ audit, transaction });
      return count > 0;
    });
  }
}
