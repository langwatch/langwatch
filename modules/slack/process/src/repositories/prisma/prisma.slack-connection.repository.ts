import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import type { Encryption } from "@langwatch/process-stores";
import { SLACK_INTEGRATION_KSUID_RESOURCE } from "@langwatch/slack-contract";
import { fromDate } from "@langwatch/time";

import {
  SlackConnectionRepository,
  type SlackConnectionChanges,
  type SlackConnectionRecord,
  type SlackConnectionRow,
  type SlackScope,
} from "../slack-connection.repository.ts";

/** Only the model this repository touches. */
export type SlackConnectionDatabase = Pick<PrismaClient, "slackIntegration">;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const rowSelect = {
  id: true,
  name: true,
  kind: true,
  scopeType: true,
  scopeId: true,
  organizationId: true,
  botTokenEncrypted: true,
  webhookUrlEncrypted: true,
  secretFingerprint: true,
  secretHint: true,
  slackTeamId: true,
  slackTeamName: true,
  createdAt: true,
  updatedAt: true,
} as const;

type StoredRow = Omit<SlackConnectionRow, "botToken" | "webhookUrl" | "createdAt" | "updatedAt"> & {
  botTokenEncrypted: string | null;
  webhookUrlEncrypted: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const opened = ({ value, encryption }: { value: string | null; encryption: Encryption }) =>
  value === null ? null : encryption.decrypt(value);

const sealed = ({ value, encryption }: { value: string | null; encryption: Encryption }) =>
  value === null ? null : encryption.encrypt(value);

const omitSecrets = <T extends Pick<Partial<SlackConnectionRecord>, "botToken" | "webhookUrl">>({
  botToken: _botToken,
  webhookUrl: _webhookUrl,
  ...rest
}: T): Omit<T, "botToken" | "webhookUrl"> => rest;

export class PrismaSlackConnectionRepository extends SlackConnectionRepository {
  static readonly tables = prismaTables("SlackIntegration");

  private constructor(
    private readonly prisma: SlackConnectionDatabase,
    private readonly encryption: Encryption,
  ) {
    super();
  }

  static create({
    prisma,
    encryption,
  }: {
    prisma: SlackConnectionDatabase;
    encryption: Encryption;
  }): PrismaSlackConnectionRepository {
    return new PrismaSlackConnectionRepository(prisma, encryption);
  }

  private toRow(row: StoredRow): SlackConnectionRow {
    const { botTokenEncrypted, webhookUrlEncrypted, ...rest } = row;
    return {
      ...rest,
      botToken: opened({ value: botTokenEncrypted, encryption: this.encryption }),
      webhookUrl: opened({ value: webhookUrlEncrypted, encryption: this.encryption }),
      createdAt: fromDate(row.createdAt),
      updatedAt: fromDate(row.updatedAt),
    };
  }

  /** The secret columns of a write; an absent field leaves its column as it is. */
  private sealedColumns({
    botToken,
    webhookUrl,
  }: Pick<Partial<SlackConnectionRecord>, "botToken" | "webhookUrl">) {
    const encryption = this.encryption;
    return {
      ...(botToken === undefined
        ? {}
        : { botTokenEncrypted: sealed({ value: botToken, encryption }) }),
      ...(webhookUrl === undefined
        ? {}
        : { webhookUrlEncrypted: sealed({ value: webhookUrl, encryption }) }),
    };
  }

  async findById({ id }: { id: string }): Promise<SlackConnectionRow[]> {
    const row = await this.prisma.slackIntegration.findUnique({ where: { id }, select: rowSelect });
    return row ? [this.toRow(row)] : [];
  }

  async findAllUsableByProject({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }): Promise<SlackConnectionRow[]> {
    const rows = await this.prisma.slackIntegration.findMany({
      where: {
        organizationId,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "PROJECT", scopeId: projectId },
        ],
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      select: rowSelect,
    });
    return rows.map((row) => this.toRow(row));
  }

  async findAllByFingerprint({
    organizationId,
    secretFingerprint,
    scopes,
  }: {
    organizationId: string;
    secretFingerprint: string;
    scopes: SlackScope[];
  }): Promise<SlackConnectionRow[]> {
    if (scopes.length === 0) return [];
    const rows = await this.prisma.slackIntegration.findMany({
      where: {
        organizationId,
        secretFingerprint,
        OR: scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
      },
      orderBy: { createdAt: "asc" },
      select: rowSelect,
    });
    return rows.map((row) => this.toRow(row));
  }

  async create({
    record,
    actorId,
  }: {
    record: SlackConnectionRecord;
    actorId: string;
  }): Promise<SlackConnectionRow[]> {
    try {
      const row = await this.prisma.slackIntegration.create({
        data: {
          ...omitSecrets(record),
          ...this.sealedColumns(record),
          id: generate(SLACK_INTEGRATION_KSUID_RESOURCE).toString(),
          createdById: actorId,
          updatedById: actorId,
        },
        select: rowSelect,
      });
      return [this.toRow(row)];
    } catch (error) {
      if (isUniqueConstraintError(error)) return [];
      throw error;
    }
  }

  async update({
    id,
    organizationId,
    changes,
    actorId,
  }: {
    id: string;
    organizationId: string;
    changes: SlackConnectionChanges;
    actorId: string;
  }): Promise<SlackConnectionRow[]> {
    try {
      const row = await this.prisma.slackIntegration.update({
        where: { id, organizationId },
        data: { ...omitSecrets(changes), ...this.sealedColumns(changes), updatedById: actorId },
        select: rowSelect,
      });
      return [this.toRow(row)];
    } catch (error) {
      if (isUniqueConstraintError(error)) return [];
      throw error;
    }
  }

  async delete({ id, organizationId }: { id: string; organizationId: string }): Promise<void> {
    await this.prisma.slackIntegration.deleteMany({ where: { id, organizationId } });
  }
}
