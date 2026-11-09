/** The per-scan ClickHouse tasks one facet discovery pass fans out to, each timed by the caller. */

import type {
  BatchedFacetResult,
  DiscreteFacetResult,
  FacetDescriptor,
  TraceListRead,
} from "@langwatch/trace-contract";

import type {
  FacetCatalog,
  ExpressionCategoricalDef,
  FacetDefinition,
  FacetTable,
  RangeFacetDef,
} from "#features/facet/rules/trace-facet-registry.rules";

import type { TraceFacetDescriptorService } from "../features/facet/services/trace-facet-descriptor.service.ts";
import type { TraceFilterWhere } from "../rules/trace-filter-hidden-origins.rules.ts";
import type { DiscoverParams } from "../rules/trace-list-cache-key.rules.ts";

/** Top values fetched per categorical facet during discovery. */
const DISCOVER_TOP_N = 50;

/**
 * Distinct integer values fetched per `isDiscrete`-flagged facet. The exact distinct count comes
 * back regardless of this cap, so the sidebar can still fall back to the slider when a facet
 * exceeds its threshold.
 */
const DISCRETE_VALUE_LIMIT = 50;

/**
 * One unit of a discovery pass, not started until the pass runs it: its label,
 * how many ClickHouse statements it holds at once, and the read itself.
 */
export interface DiscoverTask {
  label: string;
  statements: number;
  run: () => Promise<Outcome>;
}

/**
 * One batch slot is one table under one predicate. Facets that share both
 * share a scan, so an unfiltered run still reads each table once.
 */
interface BatchSlot {
  table: FacetTable;
  filterWhere: TraceFilterWhere | undefined;
  categoricals: ExpressionCategoricalDef[];
  ranges: RangeFacetDef[];
}

export type BatchedRegistrySlots = Map<string, BatchSlot>;

export type Outcome =
  | { kind: "batch"; slotKey: string; result: BatchedFacetResult }
  | { kind: "standalone"; key: string; descriptor: FacetDescriptor }
  | { kind: "discrete"; key: string; result: DiscreteFacetResult };

/** The predicate every facet is counted under, memoised per facet and per slot. */
export interface FacetFilters {
  of: (def: FacetDefinition) => TraceFilterWhere | undefined;
  slotKeyOf: (def: FacetDefinition) => string;
}

/** One `settle` run: the statements it holds, the task it starts next, and its results. */
class CappedRun {
  private readonly settled: PromiseSettledResult<Outcome>[];
  private held = 0;
  private next = 0;
  private open: number;

  constructor(
    private readonly run: {
      tasks: readonly DiscoverTask[];
      limit: number;
      signal: AbortSignal;
      resolve: (settled: PromiseSettledResult<Outcome>[]) => void;
    },
  ) {
    this.settled = Array.from({ length: run.tasks.length });
    this.open = run.tasks.length;
  }

  start(): void {
    if (this.open === 0) return this.run.resolve(this.settled);
    this.run.signal.addEventListener("abort", () => this.pump(), { once: true });
    this.pump();
  }

  /** Starts every task the held statements leave room for; settles the rest once aborted. */
  private pump(): void {
    while (this.next < this.run.tasks.length) {
      if (!this.startNext()) return;
    }
  }

  /** False when the next task must wait for a running one to give its statements back. */
  private startNext(): boolean {
    const index = this.next;
    const task = this.run.tasks[index]!;
    if (this.run.signal.aborted) {
      this.next += 1;
      this.finish(index, { status: "rejected", reason: this.run.signal.reason });
      return true;
    }
    const weight = Math.min(task.statements, this.run.limit);
    if (this.held > 0 && this.held + weight > this.run.limit) return false;
    this.next += 1;
    this.held += weight;
    void (async () => task.run())()
      .then(
        (value) => this.finish(index, { status: "fulfilled", value }),
        (reason: unknown) => this.finish(index, { status: "rejected", reason }),
      )
      .finally(() => {
        this.held -= weight;
        this.pump();
      });
    return true;
  }

  private finish(index: number, result: PromiseSettledResult<Outcome>): void {
    this.settled[index] = result;
    this.open -= 1;
    if (this.open === 0) this.run.resolve(this.settled);
  }
}

export class TraceDiscoverTaskService {
  private readonly repository: TraceListRead;
  private readonly descriptors: TraceFacetDescriptorService;
  private readonly facets: FacetCatalog;

  private constructor(deps: {
    repository: TraceListRead;
    descriptors: TraceFacetDescriptorService;
    facets: FacetCatalog;
  }) {
    this.repository = deps.repository;
    this.descriptors = deps.descriptors;
    this.facets = deps.facets;
  }

  static create(deps: {
    repository: TraceListRead;
    descriptors: TraceFacetDescriptorService;
    facets: FacetCatalog;
  }): TraceDiscoverTaskService {
    return new TraceDiscoverTaskService(deps);
  }

  /**
   * Runs `tasks` holding at most `limit` statements at once, settled in input order. A task
   * not started when `signal` aborts is never started; it settles rejected with the reason.
   */
  settle({
    tasks,
    limit,
    signal,
  }: {
    tasks: readonly DiscoverTask[];
    limit: number;
    signal: AbortSignal;
  }): Promise<PromiseSettledResult<Outcome>[]> {
    return new Promise((resolve) => new CappedRun({ tasks, limit, signal, resolve }).start());
  }

  /** Simple-expression facets per table share one batched ClickHouse scan. */
  batchTasks(params: DiscoverParams, batched: BatchedRegistrySlots): DiscoverTask[] {
    return [...batched].map(([slotKey, slot]) => ({
      label: `batch:${slotKey}`,
      // One statement for the categoricals and one for the ranges, run side by side.
      statements: Math.max(
        1,
        Number(slot.categoricals.length > 0) + Number(slot.ranges.length > 0),
      ),
      run: () =>
        this.repository
          .findBatchedFacets({
            authorization: params.authorization,
            timeRange: params.timeRange,
            table: slot.table,
            timeColumn: this.facets.timeColumns[slot.table],
            categoricalSpecs: slot.categoricals.map((d) => ({
              key: d.key,
              expression: d.expression,
            })),
            rangeSpecs: slot.ranges.map((d) => ({ key: d.key, expression: d.expression })),
            topN: DISCOVER_TOP_N,
            ...(slot.filterWhere ? { filterWhere: slot.filterWhere } : {}),
            ...(params.signal ? { signal: params.signal } : {}),
          })
          .then((result): Outcome => ({ kind: "batch", slotKey, result })),
    }));
  }

  /** arrayJoin, queryBuilder and dynamic-keys facets cannot share a scan. */
  standaloneTasks({
    params,
    standalone,
    filters,
  }: {
    params: DiscoverParams;
    standalone: FacetDefinition[];
    filters: FacetFilters;
  }): DiscoverTask[] {
    return standalone.map((def) => ({
      label: `standalone:${def.kind}:${def.key}`,
      statements: 1,
      run: async (): Promise<Outcome> => {
        const filterWhere = filters.of(def);
        let descriptor: FacetDescriptor;
        switch (def.kind) {
          case "categorical":
            descriptor = await this.descriptors.discoverCategorical({
              def,
              params,
              limit: DISCOVER_TOP_N,
              ...(filterWhere ? { filterWhere } : {}),
            });
            break;
          case "range":
            descriptor = await this.descriptors.discoverRange({
              def,
              params,
              ...(filterWhere ? { filterWhere } : {}),
            });
            break;
          case "dynamic_keys":
            descriptor = await this.descriptors.discoverDynamicKeys({
              def,
              params,
              limit: DISCOVER_TOP_N,
            });
            break;
        }

        return { kind: "standalone", key: def.key, descriptor };
      },
    }));
  }

  /**
   * Distinct-value discovery for `isDiscrete`-flagged integer facets. Runs as its own GROUP BY per
   * facet, since the batched range pass only yields min and max.
   */
  discreteTasks(params: DiscoverParams, filters: FacetFilters): DiscoverTask[] {
    return this.facets.registry
      .filter((def): def is RangeFacetDef => def.kind === "range" && def.isDiscrete === true)
      .map((def) => ({
        label: `discrete:${def.key}`,
        statements: 1,
        run: () =>
          this.repository
            .findDiscreteValues({
              authorization: params.authorization,
              timeRange: params.timeRange,
              table: def.table,
              timeColumn: this.facets.timeColumns[def.table],
              column: def.expression,
              limit: DISCRETE_VALUE_LIMIT,
              ...(filters.of(def) ? { filterWhere: filters.of(def) } : {}),
              ...(params.signal ? { signal: params.signal } : {}),
            })
            .then((result): Outcome => ({ kind: "discrete", key: def.key, result })),
      }));
  }
}
