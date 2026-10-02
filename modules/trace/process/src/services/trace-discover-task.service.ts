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
} from "#rules/trace-facet-registry.rules";

import type { TraceFilterWhere } from "../rules/trace-filter-hidden-origins.rules.ts";
import type { DiscoverParams } from "../rules/trace-list-cache-key.rules.ts";
import type { TraceFacetDescriptorService } from "./trace-facet-descriptor.service.ts";

/** Top values fetched per categorical facet during discovery. */
const DISCOVER_TOP_N = 50;

/**
 * Distinct integer values fetched per `isDiscrete`-flagged facet. The exact distinct count comes
 * back regardless of this cap, so the sidebar can still fall back to the slider when a facet
 * exceeds its threshold.
 */
const DISCRETE_VALUE_LIMIT = 50;

type TaskTimer = <T>(label: string, p: Promise<T>) => Promise<T>;

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

  /** Simple-expression facets per table share one batched ClickHouse scan. */
  batchTasks(
    params: DiscoverParams,
    batched: BatchedRegistrySlots,
    wrap: TaskTimer,
  ): Promise<Outcome>[] {
    return [...batched].map(([slotKey, slot]) =>
      wrap(
        `batch:${slotKey}`,
        this.repository
          .findBatchedFacets({
            tenantId: params.tenantId,
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
          })
          .then((result): Outcome => ({ kind: "batch", slotKey, result })),
      ),
    );
  }

  /** arrayJoin, queryBuilder and dynamic-keys facets cannot share a scan. */
  standaloneTasks({
    params,
    standalone,
    filters,
    wrap,
  }: {
    params: DiscoverParams;
    standalone: FacetDefinition[];
    filters: FacetFilters;
    wrap: TaskTimer;
  }): Promise<Outcome>[] {
    return standalone.map((def) =>
      wrap(
        `standalone:${def.kind}:${def.key}`,
        (async (): Promise<Outcome> => {
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
        })(),
      ),
    );
  }

  /**
   * Distinct-value discovery for `isDiscrete`-flagged integer facets. Runs as its own GROUP BY per
   * facet, since the batched range pass only yields min and max.
   */
  discreteTasks(
    params: DiscoverParams,
    filters: FacetFilters,
    wrap: TaskTimer,
  ): Promise<Outcome>[] {
    return this.facets.registry
      .filter((def): def is RangeFacetDef => def.kind === "range" && def.isDiscrete === true)
      .map((def) =>
        wrap(
          `discrete:${def.key}`,
          this.repository
            .findDiscreteValues({
              tenantId: params.tenantId,
              timeRange: params.timeRange,
              table: def.table,
              timeColumn: this.facets.timeColumns[def.table],
              column: def.expression,
              limit: DISCRETE_VALUE_LIMIT,
              ...(filters.of(def) ? { filterWhere: filters.of(def) } : {}),
            })
            .then((result): Outcome => ({ kind: "discrete", key: def.key, result })),
        ),
      );
  }
}
