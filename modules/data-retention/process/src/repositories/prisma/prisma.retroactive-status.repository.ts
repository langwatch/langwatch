import { PrismaRepository } from "@langwatch/prisma-client";

import { emptyRetroactiveStatus } from "../../rules/retroactive-status.rules.ts";
import {
  type IssuedRetroactiveTargets,
  issuedRetroactiveTargetsSchema,
  type RetroactiveStatus,
  type RetroactiveStatusRepository,
  retroactiveStatusSchema,
} from "../retroactive-status.repository.ts";

type StatusRow = {
  projectId: string;
  pending: unknown;
  mutations: unknown;
  failed: unknown;
  closedRequestIds: unknown;
  issued: unknown;
  lastAppliedEventId: string;
};

function parseRow(row: StatusRow): RetroactiveStatus {
  return retroactiveStatusSchema.parse({
    projectId: row.projectId,
    pending: row.pending,
    mutations: row.mutations,
    failed: row.failed,
    closedRequestIds: row.closedRequestIds,
    issued: row.issued,
    lastAppliedEventId: row.lastAppliedEventId,
  });
}

/** Each project's retroactive retention status, written only by the worker. */
export class PrismaRetroactiveStatusRepository
  extends PrismaRepository.for("RetroactiveRetentionStatus")
  implements RetroactiveStatusRepository
{
  static readonly create = this.factory((prisma) => new PrismaRetroactiveStatusRepository(prisma));

  async getForProject({ projectId }: { projectId: string }): Promise<RetroactiveStatus> {
    const row = await this.prisma.retroactiveRetentionStatus.findUnique({ where: { projectId } });
    return row ? parseRow(row) : emptyRetroactiveStatus({ projectId });
  }

  async save(status: RetroactiveStatus): Promise<void> {
    const parsed = retroactiveStatusSchema.parse(status);
    const fields = {
      pending: parsed.pending,
      mutations: parsed.mutations,
      failed: parsed.failed,
      closedRequestIds: parsed.closedRequestIds,
      lastAppliedEventId: parsed.lastAppliedEventId,
    };
    await this.prisma.retroactiveRetentionStatus.upsert({
      where: { projectId: parsed.projectId },
      create: { projectId: parsed.projectId, ...fields },
      update: fields,
    });
  }

  async saveIssued(input: {
    projectId: string;
    issued: IssuedRetroactiveTargets[];
  }): Promise<void> {
    const issued = input.issued.map((entry) => issuedRetroactiveTargetsSchema.parse(entry));
    await this.prisma.retroactiveRetentionStatus.upsert({
      where: { projectId: input.projectId },
      create: { projectId: input.projectId, issued },
      update: { issued },
    });
  }
}
