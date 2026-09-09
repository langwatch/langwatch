import { Prisma } from "@langwatch/prisma-client/generated";
import {
  enabledGuardrailMonitorSchema,
  monitorMappingsInputSchema,
  monitorSchema,
  monitorSummarySchema,
  monitorWithEvaluatorSchema,
  type EnabledGuardrailMonitor,
  type Monitor,
  type MonitorCreateInput,
  type MonitorEnabledGuardrailInput,
  type MonitorExecutionMode,
  type MonitorExperimentUpsertInput,
  type MonitorMappingState,
  type MonitorSummary,
  type MonitorToggleInput,
  type MonitorUpdateInput,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { isRecordNotFoundError } from "@langwatch/prisma-client/errors";
import { MonitorNotFoundError } from "@langwatch/monitor-contract";
import type { MonitorRepository } from "../monitor.repository.ts";

/** A write that named a row this project does not hold, said by name. */
async function whenPresent<T>(monitorId: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isRecordNotFoundError(error)) throw new MonitorNotFoundError(monitorId);
    throw error;
  }
}

const summarySelect = {
  id: true,
  checkType: true,
  name: true,
  threadIdleTimeout: true,
  evaluator: { select: { name: true } },
} as const;

const guardrailSelect = {
  id: true,
  evaluatorId: true,
  checkType: true,
  parameters: true,
} as const;

function mapMonitor(row: unknown): Monitor {
  return monitorSchema.parse(normalizeRow(row));
}

function mapMonitorWithEvaluator(row: unknown): MonitorWithEvaluator {
  return monitorWithEvaluatorSchema.parse(normalizeRow(row));
}

/** Legacy `{}` mappings are read back as the canonical empty mapping. */
function normalizeRow(row: unknown): unknown {
  if (row === null || typeof row !== "object" || !("mappings" in row)) {
    return row;
  }
  const mappings = row.mappings === null ? null : monitorMappingsInputSchema.parse(row.mappings);
  return { ...row, mappings };
}

export class PrismaMonitorRepository
  extends PrismaRepository.for("Monitor")
  implements MonitorRepository
{
  static readonly create = this.factory((prisma) => new PrismaMonitorRepository(prisma));

  async findAll(input: { projectId: string }): Promise<MonitorWithEvaluator[]> {
    const rows = await this.prisma.monitor.findMany({
      where: { projectId: input.projectId },
      orderBy: { createdAt: "asc" },
      include: { evaluator: true },
    });

    return rows.map(mapMonitorWithEvaluator);
  }

  async findEnabledOnMessage(projectId: string): Promise<MonitorSummary[]> {
    const rows = await this.prisma.monitor.findMany({
      where: { projectId, enabled: true, executionMode: "ON_MESSAGE" },
      select: summarySelect,
    });

    return rows.map((row) => monitorSummarySchema.parse(row));
  }

  async findEnabledGuardrails(
    input: MonitorEnabledGuardrailInput,
  ): Promise<EnabledGuardrailMonitor[]> {
    if (input.evaluatorIds.length === 0) return [];

    const rows = await this.prisma.monitor.findMany({
      where: {
        projectId: input.projectId,
        evaluatorId: { in: input.evaluatorIds },
        executionMode: "AS_GUARDRAIL",
        enabled: true,
      },
      select: guardrailSelect,
    });

    return rows.map((row) => enabledGuardrailMonitorSchema.parse(row));
  }

  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<MonitorWithEvaluator | undefined> {
    const row = await this.prisma.monitor.findFirst({
      where: { id: input.id, projectId: input.projectId },
      include: { evaluator: true },
    });

    return row ? mapMonitorWithEvaluator(row) : undefined;
  }

  async findAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]> {
    if (input.monitorIds.length === 0) return [];

    const rows = await this.prisma.monitor.findMany({
      where: { id: { in: input.monitorIds }, projectId: input.projectId },
    });

    return rows.map(mapMonitor);
  }

  async findIdByName(input: { projectId: string; name: string }): Promise<string | undefined> {
    const row = await this.prisma.monitor.findFirst({
      where: { projectId: input.projectId, name: input.name },
      select: { id: true },
    });

    return row?.id;
  }

  async setEnabled(input: MonitorToggleInput): Promise<void> {
    await whenPresent(input.id, () =>
      this.prisma.monitor.update({
        where: { id: input.id, projectId: input.projectId },
        data: { enabled: input.enabled },
      }),
    );
  }

  async create(
    input: MonitorCreateInput & { id: string; slug: string; mappings: MonitorMappingState },
  ): Promise<Monitor> {
    const row = await this.prisma.monitor.create({
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
    const row = await this.prisma.monitor.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        checkType: input.checkType,
        preconditions: input.preconditions as Prisma.InputJsonValue,
        parameters: input.parameters as Prisma.InputJsonValue,
        mappings:
          input.mappings === null ? Prisma.JsonNull : (input.mappings as Prisma.InputJsonValue),
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
    const row = await whenPresent(input.id, () =>
      this.prisma.monitor.update({
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
      }),
    );

    return mapMonitor(row);
  }

  async delete(input: { id: string; projectId: string }): Promise<void> {
    await whenPresent(input.id, () =>
      this.prisma.monitor.delete({ where: { id: input.id, projectId: input.projectId } }),
    );
  }

  async deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void> {
    await this.prisma.monitor.deleteMany({ where: input });
  }

  async upsertForExperiment(
    input: MonitorExperimentUpsertInput & {
      id: string;
      mappings: MonitorMappingState;
      executionMode: MonitorExecutionMode;
    },
  ): Promise<Monitor> {
    // The same values on both branches: an experiment republished is the same
    // monitor rewritten, so nothing but the row's identity differs between the
    // first save and the tenth.
    const configuration = {
      name: input.name,
      checkType: input.checkType,
      slug: input.slug,
      preconditions: input.preconditions as Prisma.InputJsonValue,
      parameters: input.parameters as Prisma.InputJsonValue,
      mappings: input.mappings as Prisma.InputJsonValue,
      sample: input.sample,
      enabled: input.enabled,
      executionMode: input.executionMode,
    };

    const row = await this.prisma.monitor.upsert({
      where: { experimentId: input.experimentId, projectId: input.projectId },
      update: configuration,
      create: {
        ...configuration,
        id: input.id,
        projectId: input.projectId,
        experimentId: input.experimentId,
      },
    });

    return mapMonitor(row);
  }
}
