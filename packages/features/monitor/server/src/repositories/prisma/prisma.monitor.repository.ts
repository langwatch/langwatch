import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import {
  monitorMappingsInputSchema,
  monitorSchema,
  monitorSummarySchema,
  monitorWithEvaluatorSchema,
  type Monitor,
  type MonitorCreateInput,
  type MonitorNameAvailabilityInput,
  type MonitorMappingState,
  type MonitorSummary,
  type MonitorToggleInput,
  type MonitorUpdateInput,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import { MonitorRepository } from "../monitor.repository";

export type MonitorDatabase = Pick<PrismaClient, "monitor">;

function mapMonitor(row: unknown): Monitor {
  return monitorSchema.parse(normalizeRow(row));
}

function mapMonitorWithEvaluator(row: unknown): MonitorWithEvaluator {
  return monitorWithEvaluatorSchema.parse(normalizeRow(row));
}

function mapSummary(row: unknown): MonitorSummary {
  return monitorSummarySchema.parse(row);
}

function normalizeRow(row: unknown): unknown {
  if (row === null || typeof row !== "object" || !("mappings" in row)) {
    return row;
  }
  const mappings =
    row.mappings === null ? null : monitorMappingsInputSchema.parse(row.mappings);
  return { ...row, mappings };
}

export class PrismaMonitorRepository extends MonitorRepository {
  static create(database: MonitorDatabase): PrismaMonitorRepository {
    return new PrismaMonitorRepository(database);
  }

  private constructor(private readonly database: MonitorDatabase) {
    super();
  }

  async findAll(input: { projectId: string }): Promise<MonitorWithEvaluator[]> {
    const rows = await this.database.monitor.findMany({
      where: { projectId: input.projectId },
      orderBy: { createdAt: "asc" },
      include: { evaluator: true },
    });
    return rows.map(mapMonitorWithEvaluator);
  }

  async findEnabledOnMessage(projectId: string): Promise<MonitorSummary[]> {
    const rows = await this.database.monitor.findMany({
      where: { projectId, enabled: true, executionMode: "ON_MESSAGE" },
      select: {
        id: true,
        checkType: true,
        name: true,
        threadIdleTimeout: true,
        evaluator: { select: { name: true } },
      },
    });
    return rows.map(mapSummary);
  }

  async tryFindById(input: {
    id: string;
    projectId: string;
  }): Promise<MonitorWithEvaluator | null> {
    const row = await this.database.monitor.findFirst({
      where: { id: input.id, projectId: input.projectId },
      include: { evaluator: true },
    });
    return row ? mapMonitorWithEvaluator(row) : null;
  }

  async findAllByIds(input: {
    monitorIds: string[];
    projectId: string;
  }): Promise<Monitor[]> {
    if (input.monitorIds.length === 0) return [];
    const rows = await this.database.monitor.findMany({
      where: { id: { in: input.monitorIds }, projectId: input.projectId },
    });
    return rows.map(mapMonitor);
  }

  async setEnabled(input: MonitorToggleInput): Promise<void> {
    await this.database.monitor.update({
      where: { id: input.id, projectId: input.projectId },
      data: { enabled: input.enabled },
    });
  }

  async create(
    input: MonitorCreateInput & {
      id: string;
      slug: string;
      mappings: MonitorMappingState;
    },
  ): Promise<Monitor> {
    const row = await this.database.monitor.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        checkType: input.checkType,
        preconditions: input.preconditions as Prisma.InputJsonValue,
        parameters: input.parameters as Prisma.InputJsonValue,
        mappings: input.mappings as Prisma.InputJsonValue,
        sample: input.sample,
        enabled: true,
        executionMode: input.executionMode,
        evaluatorId: input.evaluatorId,
        level: input.level ?? "trace",
        threadIdleTimeout: input.threadIdleTimeout,
        slug: input.slug,
      },
    });
    return mapMonitor(row);
  }

  async createReplica(input: Monitor): Promise<Monitor> {
    const row = await this.database.monitor.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        checkType: input.checkType,
        preconditions: input.preconditions as Prisma.InputJsonValue,
        parameters: input.parameters as Prisma.InputJsonValue,
        mappings:
          input.mappings === null
            ? Prisma.JsonNull
            : (input.mappings as Prisma.InputJsonValue),
        sample: input.sample,
        enabled: input.enabled,
        executionMode: input.executionMode,
        evaluatorId: input.evaluatorId,
        level: input.level,
        threadIdleTimeout: input.threadIdleTimeout,
        slug: input.slug,
      },
    });
    return mapMonitor(row);
  }

  async update(
    input: MonitorUpdateInput & { slug: string; mappings: MonitorMappingState },
  ): Promise<Monitor> {
    const row = await this.database.monitor.update({
      where: { id: input.id, projectId: input.projectId },
      data: {
        name: input.name,
        checkType: input.checkType,
        preconditions: input.preconditions as Prisma.InputJsonValue,
        parameters: input.parameters as Prisma.InputJsonValue,
        mappings: input.mappings as Prisma.InputJsonValue,
        sample: input.sample,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        executionMode: input.executionMode,
        ...(input.evaluatorId !== undefined ? { evaluatorId: input.evaluatorId } : {}),
        ...(input.level !== undefined ? { level: input.level } : {}),
        ...(input.threadIdleTimeout !== undefined
          ? { threadIdleTimeout: input.threadIdleTimeout }
          : {}),
        slug: input.slug,
      },
    });
    return mapMonitor(row);
  }

  async delete(input: { id: string; projectId: string }): Promise<void> {
    await this.database.monitor.delete({
      where: { id: input.id, projectId: input.projectId },
    });
  }

  async deleteForExperiment(input: {
    projectId: string;
    experimentId: string;
  }): Promise<void> {
    await this.database.monitor.deleteMany({ where: input });
  }

  async isNameAvailable(input: MonitorNameAvailabilityInput): Promise<boolean> {
    const row = await this.database.monitor.findFirst({
      where: { projectId: input.projectId, name: input.name },
      select: { id: true },
    });
    return row === null || row.id === input.checkId;
  }
}
