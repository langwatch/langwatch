import {
  type StoredTraceCount,
  TraceCountRepository,
  type TraceCountState,
} from "../trace-count.repository.ts";

type Row = StoredTraceCount & { organizationId: string; traces: number };

/** In-memory twin: one row per organization, project and month, the last write kept. */
export class MemoryTraceCountRepository extends TraceCountRepository {
  readonly #rows = new Map<string, Row>();

  protected constructor() {
    super();
  }

  static create(): MemoryTraceCountRepository {
    return new MemoryTraceCountRepository();
  }

  async find(input: {
    organizationId: string;
    projectId: string;
    month: string;
  }): Promise<StoredTraceCount[]> {
    const row = this.#rows.get(keyOf(input));
    return row ? [{ state: row.state, appliedEventIds: row.appliedEventIds }] : [];
  }

  async save({
    organizationId,
    state,
    traces,
    appliedEventIds,
  }: {
    organizationId: string;
    state: TraceCountState;
    traces: number;
    appliedEventIds: readonly string[];
  }): Promise<void> {
    const key = keyOf({ organizationId, projectId: state.projectId, month: state.month });
    this.#rows.set(key, { organizationId, state, traces, appliedEventIds: [...appliedEventIds] });
  }

  async findTotal(input: { organizationId: string; month: string }): Promise<number> {
    let total = 0;
    for (const row of this.#rows.values()) {
      if (row.organizationId === input.organizationId && row.state.month === input.month) {
        total += row.traces;
      }
    }
    return total;
  }

  async countByProjects(input: {
    organizationId: string;
    projectIds: readonly string[];
    month: string;
  }): Promise<{ projectId: string; count: number }[]> {
    const named = new Set(input.projectIds);
    return [...this.#rows.values()]
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          row.state.month === input.month &&
          named.has(row.state.projectId),
      )
      .map((row) => ({ projectId: row.state.projectId, count: row.traces }));
  }
}

function keyOf(input: { organizationId: string; projectId: string; month: string }): string {
  return `${input.organizationId}\u0000${input.projectId}\u0000${input.month}`;
}
