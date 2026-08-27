import {
  TriggerNotFoundError,
  type CreateTriggerCommand,
  type Trigger,
  type TriggerSummary,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { TriggerRepository, type ReportScheduleTarget } from "../trigger.repository";
import { mapTriggerRow } from "./prisma.trigger.mapper";
import type { AutomationClock } from "../../ports/automation-clock.port";

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => toPrismaJsonValue(entry));
  if (typeof value === "object") {
    const result: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) result[key] = toPrismaJsonValue(entry);
    }
    return result;
  }
  throw new Error("Automation action parameters must contain JSON values");
}

function toPrismaJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = toPrismaJsonValue(entry);
  }
  return result;
}

export class PrismaTriggerRepository extends TriggerRepository {
  private constructor(
    private readonly database: PrismaClient,
    private readonly clock: AutomationClock,
  ) {
    super();
  }
  static create(database: object, clock: AutomationClock): PrismaTriggerRepository {
    return new PrismaTriggerRepository(database as PrismaClient, clock);
  }
  async findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
    const rows = await this.database.trigger.findMany({
      where: { projectId, active: true, deleted: false },
    });
    return rows.map((row: unknown) => mapTriggerRow(row));
  }
  async findActiveReportTargets(): Promise<ReportScheduleTarget[]> {
    return this.database.$queryRaw<ReportScheduleTarget[]>`
			SELECT "id", "projectId", "actionParams"
			FROM "Trigger"
			WHERE "triggerKind" = 'REPORT'
			  AND "active" = true
			  AND "deleted" = false
			-- @tenancy: report-schedule reconciliation cross-tenant sweep (worker boot)
		`;
  }
  async claimSend(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    const result = await this.database.triggerSent.createMany({
      data: [input],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
  async isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return (
      (await this.database.triggerSent.findFirst({
        where: input,
        select: { id: true },
      })) !== null
    );
  }
  async findClaimedTraceIds(input: {
    triggerId: string;
    traceIds: string[];
    projectId: string;
  }): Promise<Set<string>> {
    if (input.traceIds.length === 0) return new Set();
    const rows = await this.database.triggerSent.findMany({
      where: {
        triggerId: input.triggerId,
        projectId: input.projectId,
        traceId: { in: input.traceIds },
      },
      select: { traceId: true },
    });
    return new Set(
      rows.flatMap((row: unknown) => {
        const id = (row as { traceId?: unknown }).traceId;
        return typeof id === "string" ? [id] : [];
      }),
    );
  }
  async updateLastRunAt(input: { triggerId: string; projectId: string }): Promise<void> {
    await this.database.trigger.update({
      where: { id: input.triggerId, projectId: input.projectId },
      data: { lastRunAt: this.clock.now().getTime() },
    });
  }
  async findByIdOrThrow(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    const row = await this.database.trigger.findFirst({
      where: { id: input.triggerId, projectId: input.projectId },
    });
    if (row === null) throw new TriggerNotFoundError();
    return mapTriggerRow(row);
  }
  async tryFindById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    const row = await this.database.trigger.findFirst({
      where: { id: input.triggerId, projectId: input.projectId },
    });
    return row === null ? null : mapTriggerRow(row);
  }
  async findAllByProjectId(input: { projectId: string }): Promise<Trigger[]> {
    const rows = await this.database.trigger.findMany({
      where: { projectId: input.projectId, deleted: false },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row: unknown) => mapTriggerRow(row));
  }
  async tryFindByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    const row = await this.database.trigger.findFirst({
      where: { projectId: input.projectId, customGraphId: input.customGraphId },
    });
    return row === null ? null : mapTriggerRow(row);
  }
  async findByCustomGraphIds(input: {
    projectId: string;
    customGraphIds: string[];
  }): Promise<Trigger[]> {
    if (input.customGraphIds.length === 0) return [];
    const rows = await this.database.trigger.findMany({
      where: {
        projectId: input.projectId,
        customGraphId: { in: input.customGraphIds },
      },
    });
    return rows.map((row: unknown) => mapTriggerRow(row));
  }
  async create(input: CreateTriggerCommand): Promise<Trigger> {
    const { actionParams, filters, ...rest } = input;
    const row = await this.database.trigger.create({
      data: {
        ...(rest.id ? { id: rest.id } : {}),
        ...rest,
        actionParams: toPrismaJsonObject(actionParams),
        lastRunAt: input.lastRunAt?.getTime() ?? this.clock.now().getTime(),
        triggerKind: input.triggerKind ?? "AUTOMATION",
        filters: toPrismaJsonObject(filters ?? {}),
        filterQuery: input.filterQuery ?? null,
        message: input.message ?? null,
        alertType: input.alertType ?? null,
        customGraphId: input.customGraphId ?? null,
      },
    });
    return mapTriggerRow(row);
  }
  async update(input: UpdateTriggerCommand): Promise<Trigger> {
    const { id, projectId, lastRunAt, actionParams, filters, ...data } = input;
    const row = await this.database.trigger.update({
      where: { id, projectId },
      data: {
        ...data,
        ...(actionParams !== undefined ? { actionParams: toPrismaJsonObject(actionParams) } : {}),
        ...(filters !== undefined ? { filters: toPrismaJsonObject(filters) } : {}),
        ...(lastRunAt !== undefined
          ? { lastRunAt: lastRunAt === null ? 0 : lastRunAt.getTime() }
          : {}),
      },
    });
    return mapTriggerRow(row);
  }
}
