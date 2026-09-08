/**
 * The monitor rows, in memory, answering exactly what the Prisma repository
 * answers: the same ordering, the same project scoping, the same canonical
 * mappings on the way out, and the same refusal when a write names a row the
 * project does not hold.
 */
import {
  enabledGuardrailMonitorSchema,
  monitorMappingsInputSchema,
  monitorSchema,
  MonitorNotFoundError,
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
import { nowInstant, toDate } from "@langwatch/time";
import type { MonitorRepository } from "../monitor.repository.ts";

/** A stored row: the monitor, plus the evaluator name a listing reads off it. */
type StoredMonitor = Monitor & { evaluator: MonitorWithEvaluator["evaluator"] };

export class MemoryMonitorRepository implements MonitorRepository {
  #rows: StoredMonitor[] = [];

  private constructor() {}

  static create(): MemoryMonitorRepository {
    return new MemoryMonitorRepository();
  }

  /** Seeds a row the way a fixture or a contract test needs it to already exist. */
  seed(monitor: StoredMonitor): void {
    this.#rows.push(structuredClone(monitor));
  }

  async findAll(input: { projectId: string }): Promise<MonitorWithEvaluator[]> {
    return this.#rows
      .filter((row) => row.projectId === input.projectId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((row) => this.#withEvaluator(row));
  }

  async findEnabledOnMessage(projectId: string): Promise<MonitorSummary[]> {
    return this.#rows
      .filter(
        (row) => row.projectId === projectId && row.enabled && row.executionMode === "ON_MESSAGE",
      )
      .map((row) =>
        monitorSummarySchema.parse({
          id: row.id,
          checkType: row.checkType,
          name: row.name,
          threadIdleTimeout: row.threadIdleTimeout,
          evaluator: row.evaluator ? { name: row.evaluator.name } : null,
        }),
      );
  }

  async findEnabledGuardrails(
    input: MonitorEnabledGuardrailInput,
  ): Promise<EnabledGuardrailMonitor[]> {
    if (input.evaluatorIds.length === 0) return [];

    return this.#rows
      .filter(
        (row) =>
          row.projectId === input.projectId &&
          row.enabled &&
          row.executionMode === "AS_GUARDRAIL" &&
          row.evaluatorId !== null &&
          input.evaluatorIds.includes(row.evaluatorId),
      )
      .map((row) =>
        enabledGuardrailMonitorSchema.parse({
          id: row.id,
          evaluatorId: row.evaluatorId,
          checkType: row.checkType,
          parameters: row.parameters,
        }),
      );
  }

  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<MonitorWithEvaluator | undefined> {
    const row = this.#find(input);

    return row ? this.#withEvaluator(row) : undefined;
  }

  async findAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]> {
    if (input.monitorIds.length === 0) return [];

    return this.#rows
      .filter((row) => row.projectId === input.projectId && input.monitorIds.includes(row.id))
      .map((row) => this.#asMonitor(row));
  }

  async findIdByName(input: { projectId: string; name: string }): Promise<string | undefined> {
    return this.#rows.find(
      (row) => row.projectId === input.projectId && row.name === input.name,
    )?.id;
  }

  async setEnabled(input: MonitorToggleInput): Promise<void> {
    const row = this.#require(input);
    row.enabled = input.enabled;
    row.updatedAt = toDate(nowInstant());
  }

  async create(
    input: MonitorCreateInput & { id: string; slug: string; mappings: MonitorMappingState },
  ): Promise<Monitor> {
    const now = toDate(nowInstant());

    return this.#insert({
      id: input.id,
      projectId: input.projectId,
      experimentId: null,
      evaluatorId: input.evaluatorId ?? null,
      checkType: input.checkType,
      name: input.name,
      slug: input.slug,
      executionMode: input.executionMode,
      enabled: true,
      preconditions: input.preconditions,
      parameters: input.parameters,
      mappings: input.mappings,
      sample: input.sample,
      level: input.level ?? "trace",
      threadIdleTimeout: input.threadIdleTimeout ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async createReplica(input: Monitor): Promise<Monitor> {
    const now = toDate(nowInstant());

    return this.#insert({ ...input, createdAt: now, updatedAt: now });
  }

  async update(
    input: MonitorUpdateInput & { slug: string; mappings: MonitorMappingState },
  ): Promise<Monitor> {
    const row = this.#require(input);

    Object.assign(row, {
      name: input.name,
      checkType: input.checkType,
      preconditions: input.preconditions,
      parameters: input.parameters,
      mappings: input.mappings,
      sample: input.sample,
      executionMode: input.executionMode,
      slug: input.slug,
      updatedAt: toDate(nowInstant()),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.evaluatorId === undefined ? {} : { evaluatorId: input.evaluatorId }),
      ...(input.level === undefined ? {} : { level: input.level }),
      ...(input.threadIdleTimeout === undefined
        ? {}
        : { threadIdleTimeout: input.threadIdleTimeout }),
    });

    return this.#asMonitor(row);
  }

  async delete(input: { id: string; projectId: string }): Promise<void> {
    const row = this.#require(input);
    this.#rows = this.#rows.filter((candidate) => candidate !== row);
  }

  async deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void> {
    this.#rows = this.#rows.filter(
      (row) => !(row.projectId === input.projectId && row.experimentId === input.experimentId),
    );
  }

  async upsertForExperiment(
    input: MonitorExperimentUpsertInput & {
      id: string;
      mappings: MonitorMappingState;
      executionMode: MonitorExecutionMode;
    },
  ): Promise<Monitor> {
    const configuration = {
      name: input.name,
      checkType: input.checkType,
      slug: input.slug,
      preconditions: input.preconditions,
      parameters: input.parameters,
      mappings: input.mappings,
      sample: input.sample,
      enabled: input.enabled,
      executionMode: input.executionMode,
    };

    const existing = this.#rows.find(
      (row) => row.projectId === input.projectId && row.experimentId === input.experimentId,
    );

    if (existing) {
      Object.assign(existing, configuration, { updatedAt: toDate(nowInstant()) });

      return this.#asMonitor(existing);
    }

    const now = toDate(nowInstant());

    return this.#insert({
      ...configuration,
      id: input.id,
      projectId: input.projectId,
      experimentId: input.experimentId,
      evaluatorId: null,
      level: "trace",
      threadIdleTimeout: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * The Prisma repository names every column it writes, so a caller handing it
   * a monitor read back WITH its evaluator writes the monitor and drops the
   * join. The twin does the same rather than refusing the extra key.
   */
  #insert(candidate: Record<string, unknown>): Monitor {
    const { evaluator: _evaluator, ...columns } = candidate;
    const monitor = monitorSchema.parse({
      ...columns,
      mappings:
        columns.mappings === null ? null : monitorMappingsInputSchema.parse(columns.mappings),
    });

    this.#rows.push({ ...monitor, evaluator: null });

    return structuredClone(monitor);
  }

  #find(input: { id: string; projectId: string }): StoredMonitor | undefined {
    return this.#rows.find((row) => row.id === input.id && row.projectId === input.projectId);
  }

  #require(input: { id: string; projectId: string }): StoredMonitor {
    const row = this.#find(input);
    if (!row) throw new MonitorNotFoundError(input.id);

    return row;
  }

  #asMonitor(row: StoredMonitor): Monitor {
    const { evaluator: _evaluator, ...monitor } = row;

    return monitorSchema.parse(structuredClone(monitor));
  }

  #withEvaluator(row: StoredMonitor): MonitorWithEvaluator {
    return monitorWithEvaluatorSchema.parse(structuredClone(row));
  }
}
