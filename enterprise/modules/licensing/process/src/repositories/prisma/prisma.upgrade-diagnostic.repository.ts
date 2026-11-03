// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { UpgradeDiagnosticsNotFoundError } from "@langwatch/enterprise-licensing-contract";
import type {
  PrismaClient,
  SelfHostedInstanceDiagnostic,
} from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  type UpgradeDiagnosticInsert,
  type UpgradeDiagnosticRecord,
  UpgradeDiagnosticRepository,
} from "../upgrade-diagnostic.repository.ts";

type UpgradeDiagnosticDatabase = Pick<PrismaClient, "selfHostedInstanceDiagnostic">;

/** The report rows Cloud admin lists; the bundle bytes are object storage's. */
export class PrismaUpgradeDiagnosticRepository extends UpgradeDiagnosticRepository {
  static readonly tables = prismaTables("SelfHostedInstanceDiagnostic");

  static create(prisma: UpgradeDiagnosticDatabase): PrismaUpgradeDiagnosticRepository {
    return new PrismaUpgradeDiagnosticRepository(prisma);
  }

  private constructor(private readonly prisma: UpgradeDiagnosticDatabase) {
    super();
  }

  async insert(row: UpgradeDiagnosticInsert): Promise<void> {
    await this.prisma.selfHostedInstanceDiagnostic.create({
      data: { ...row, receivedAt: toDate(row.receivedAt), expiresAt: toDate(row.expiresAt) },
    });
  }

  async findAllByInstanceId(instanceId: string): Promise<UpgradeDiagnosticRecord[]> {
    const rows = await this.prisma.selfHostedInstanceDiagnostic.findMany({
      where: { instanceId },
      orderBy: { receivedAt: "desc" },
    });
    return rows.map(recordOf);
  }

  async findAllForStep({
    instanceId,
    stepId,
    release,
  }: {
    instanceId: string;
    stepId: string;
    release: string | null;
  }): Promise<UpgradeDiagnosticRecord[]> {
    const rows = await this.prisma.selfHostedInstanceDiagnostic.findMany({
      where: { instanceId, stepId, release },
      orderBy: { receivedAt: "asc" },
    });
    return rows.map(recordOf);
  }

  async getById(id: string): Promise<UpgradeDiagnosticRecord> {
    const row = await this.prisma.selfHostedInstanceDiagnostic.findUnique({ where: { id } });
    if (!row) throw new UpgradeDiagnosticsNotFoundError();
    return recordOf(row);
  }

  async markAnnounced({ id, at }: { id: string; at: Instant }): Promise<void> {
    await this.prisma.selfHostedInstanceDiagnostic.update({
      where: { id },
      data: { slackAnnouncedAt: toDate(at) },
    });
  }
}

function recordOf(row: SelfHostedInstanceDiagnostic): UpgradeDiagnosticRecord {
  return {
    id: row.id,
    instanceId: row.instanceId,
    stepId: row.stepId,
    stepDescription: row.stepDescription,
    release: row.release,
    attempt: row.attempt,
    trigger: row.trigger === "operator" ? "operator" : "automatic",
    byteLength: row.byteLength,
    objectKey: row.objectKey,
    receivedAt: fromDate(row.receivedAt),
    expiresAt: fromDate(row.expiresAt),
    slackAnnouncedAt: row.slackAnnouncedAt === null ? null : fromDate(row.slackAnnouncedAt),
  };
}
