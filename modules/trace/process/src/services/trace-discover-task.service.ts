/** The per-scan ClickHouse tasks one facet discovery pass fans out to, each timed by the caller. */

import type {
  BatchedFacetResult,
  DiscreteFacetResult,
  FacetDescriptor,
} from "@langwatch/trace-contract";

import type {
  FacetCatalog,
  ExpressionCategoricalDef,
  FacetDefinition,
  FacetTable,
  RangeFacetDef,
} from "#features/facet/rules/trace-facet-registry.rules";

import type { TraceFacetDescriptorService } from "../features/facet/services/trace-facet-descriptor.service.ts";
import type { TraceFacetFilter, TraceListRead } from "../repositories/trace-list.repository.ts";
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
  filter: TraceFacetFilter | undefined;
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
  of: (def: FacetDefinition) => TraceFacetFilter | undefined;
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
            categoricalKeys: slot.categoricals.map((d) => d.key),
            rangeKeys: slot.ranges.map((d) => d.key),
            topN: DISCOVER_TOP_N,
            ...(slot.filter ? { compileFilter: slot.filter.compile } : {}),
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
        const filter = filters.of(def);
        let descriptor: FacetDescriptor;
        switch (def.kind) {
          case "categorical":
            descriptor = await this.descriptors.discoverCategorical({
              def,
              params,
              limit: DISCOVER_TOP_N,
              ...(filter ? { filter } : {}),
            });
            break;
          case "range":
            descriptor = await this.descriptors.discoverRange({
              def,
              params,
              ...(filter ? { filter } : {}),
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
              facetKey: def.key,
              limit: DISCRETE_VALUE_LIMIT,
              ...(filters.of(def) ? { compileFilter: filters.of(def)?.compile } : {}),
            })
            .then((result): Outcome => ({ kind: "discrete", key: def.key, result })),
      }));
  }
}
