/**
 * Builds one facet's descriptor for the sidebar: the batched pass's rows materialised in registry
 * order, and the standalone reads an arrayJoin, queryBuilder or dynamic-keys facet needs. Held
 * apart from the discovery run so the fan-out stays about scheduling, not shaping.
 */

import type {
  BatchedFacetResult,
  CategoricalFacetDescriptor,
  CategoricalFacetResult,
  DiscreteFacetResult,
  DynamicKeysFacetDescriptor,
  FacetDescriptor,
  RangeFacetDescriptor,
  TraceListReadPort,
} from "@langwatch/trace-contract";
import type { FacetDefinition, FacetTable, RangeFacetDef } from "@langwatch/trace-server";
import { ClickHouseFacetRegistryAdapter } from "@langwatch/trace-server";

import { isExpressionCategorical } from "../rules/trace-facet-classification.rules.ts";
import type { DiscoverParams } from "../rules/trace-list-cache-key.rules.ts";
import type { TraceTopicNamingService } from "./trace-topic-naming.service.ts";

export class TraceFacetDescriptorService {
  private constructor(
    private readonly repository: TraceListReadPort,
    private readonly topicNaming: TraceTopicNamingService,
  ) {}

  static create({
    repository,
    topicNaming,
  }: {
    repository: TraceListReadPort;
    topicNaming: TraceTopicNamingService;
  }): TraceFacetDescriptorService {
    return new TraceFacetDescriptorService(repository, topicNaming);
  }

  async tryMaterializeDescriptor(
    def: FacetDefinition,
    params: DiscoverParams,
    batchByTable: Map<FacetTable, BatchedFacetResult>,
    standaloneByKey: Map<string, FacetDescriptor>,
    discreteByKey: Map<string, DiscreteFacetResult>,
  ): Promise<FacetDescriptor | null> {
    if (def.kind === "categorical" && isExpressionCategorical(def)) {
      if (def.expression.includes("arrayJoin")) {
        return standaloneByKey.get(def.key) ?? null;
      }

      const batch = batchByTable.get(def.table);
      const raw = batch?.categoricals[def.key];
      if (!raw) {
        return null;
      }

      const enriched =
        def.key === "topic" || def.key === "subtopic"
          ? await this.topicNaming.enrichTopicNames(params.tenantId, raw)
          : raw;

      return {
        key: def.key,
        kind: "categorical",
        label: def.label,
        group: def.group,
        topValues: enriched.values,
        totalDistinct: enriched.totalDistinct,
      };
    }

    if (def.kind === "range") {
      const batch = batchByTable.get(def.table);
      const range = batch?.ranges[def.key];
      if (!range) {
        return null;
      }

      const discrete = def.isDiscrete ? discreteByKey.get(def.key) : undefined;

      return {
        key: def.key,
        kind: "range",
        label: def.label,
        group: def.group,
        min: range.min,
        max: range.max,
        ...(discrete ? { discrete } : {}),
      };
    }

    return standaloneByKey.get(def.key) ?? null;
  }

  async discoverCategorical(
    def: FacetDefinition & { kind: "categorical" },
    params: DiscoverParams,
    limit: number,
  ): Promise<CategoricalFacetDescriptor> {
    let result: CategoricalFacetResult;

    if (isExpressionCategorical(def)) {
      result = await this.repository.findCategoricalFacet({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        table: def.table,
        timeColumn: ClickHouseFacetRegistryAdapter.TABLE_TIME_COLUMNS[def.table],
        facetExpression: def.expression,
        limit,
        offset: 0,
      });
    } else {
      const query = def.queryBuilder({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        limit,
        offset: 0,
      });
      result = await this.repository.findCategoricalFacetRaw({
        tenantId: params.tenantId,
        query,
      });
    }

    if (def.key === "topic" || def.key === "subtopic") {
      result = await this.topicNaming.enrichTopicNames(params.tenantId, result);
    }

    return {
      key: def.key,
      kind: "categorical",
      label: def.label,
      group: def.group,
      topValues: result.values,
      totalDistinct: result.totalDistinct,
    };
  }

  async discoverRange(def: RangeFacetDef, params: DiscoverParams): Promise<RangeFacetDescriptor> {
    const result = await this.repository.findRangeStatsForTable({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      table: def.table,
      timeColumn: ClickHouseFacetRegistryAdapter.TABLE_TIME_COLUMNS[def.table],
      column: def.expression,
    });

    return {
      key: def.key,
      kind: "range",
      label: def.label,
      group: def.group,
      min: result.min,
      max: result.max,
    };
  }

  async discoverDynamicKeys(
    def: FacetDefinition & { kind: "dynamic_keys" },
    params: DiscoverParams,
    limit: number,
  ): Promise<DynamicKeysFacetDescriptor> {
    const query = def.queryBuilder({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      limit,
      offset: 0,
    });
    const result = await this.repository.findCategoricalFacetRaw({
      tenantId: params.tenantId,
      query,
    });

    return {
      key: def.key,
      kind: "dynamic_keys",
      label: def.label,
      group: def.group,
      topKeys: result.values.map((v) => ({
        value: v.value,
        count: v.count,
      })),
      totalDistinct: result.totalDistinct,
    };
  }
}
