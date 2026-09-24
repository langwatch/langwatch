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
  TraceListRead,
} from "@langwatch/trace-contract";

import type {
  ExpressionCategoricalDef,
  FacetDefinition,
  RangeFacetDef,
} from "#repositories/clickhouse/clickhouse.trace-facet-registry.repository";

import { ClickHouseFacetRegistryAdapter } from "../repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import { isExpressionCategorical } from "../rules/trace-facet-classification.rules.ts";
import { scopeTraceFilterToTable } from "../rules/trace-facet-scope.rules.ts";
import type { TraceFilterWhere } from "../rules/trace-filter-hidden-origins.rules.ts";
import type { DiscoverParams } from "../rules/trace-list-cache-key.rules.ts";
import type { TraceTopicNamingService } from "./trace-topic-naming.service.ts";

export class TraceFacetDescriptorService {
  private constructor(
    private readonly repository: TraceListRead,
    private readonly topicNaming: TraceTopicNamingService,
  ) {}

  static create({
    repository,
    topicNaming,
  }: {
    repository: TraceListRead;
    topicNaming: TraceTopicNamingService;
  }): TraceFacetDescriptorService {
    return new TraceFacetDescriptorService(repository, topicNaming);
  }

  async buildDescriptor({
    def,
    params,
    batch,
    standaloneByKey,
    discreteByKey,
  }: {
    def: FacetDefinition;
    /** The batched result of the slot this facet was read in, when it had one. */
    batch: BatchedFacetResult | undefined;
    params: DiscoverParams;
    standaloneByKey: Map<string, FacetDescriptor>;
    discreteByKey: Map<string, DiscreteFacetResult>;
  }): Promise<FacetDescriptor | null> {
    if (isExpressionCategorical(def)) {
      return this.materializeCategorical({ def, params, batch, standaloneByKey });
    }

    if (def.kind === "range") {
      return this.materializeRange({ def, batch, discreteByKey });
    }

    return standaloneByKey.get(def.key) ?? null;
  }

  /** A categorical facet's descriptor: the batched top values, topic names resolved. */
  private async materializeCategorical({
    def,
    params,
    batch,
    standaloneByKey,
  }: {
    def: ExpressionCategoricalDef;
    params: DiscoverParams;
    batch: BatchedFacetResult | undefined;
    standaloneByKey: Map<string, FacetDescriptor>;
  }): Promise<FacetDescriptor | null> {
    if (def.expression.includes("arrayJoin")) {
      return standaloneByKey.get(def.key) ?? null;
    }

    const raw = batch?.categoricals[def.key];
    if (!raw) {
      return null;
    }

    const namesTopics = def.key === "topic" || def.key === "subtopic";
    const enriched = namesTopics
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

  /** A range facet's descriptor: the batched bounds, plus the discrete values when it has them. */
  private materializeRange({
    def,
    batch,
    discreteByKey,
  }: {
    def: RangeFacetDef;
    batch: BatchedFacetResult | undefined;
    discreteByKey: Map<string, DiscreteFacetResult>;
  }): FacetDescriptor | null {
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

  async discoverCategorical({
    def,
    params,
    limit,
    filterWhere,
  }: {
    def: FacetDefinition & { kind: "categorical" };
    params: DiscoverParams;
    limit: number;
    /** The predicate this facet is counted under; absent on the discover read. */
    filterWhere?: TraceFilterWhere;
  }): Promise<CategoricalFacetDescriptor> {
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
        ...(filterWhere ? { filterWhere } : {}),
      });
    } else {
      const query = def.queryBuilder({
        tenantId: params.tenantId,
        timeRange: params.timeRange,
        limit,
        offset: 0,
        ...(filterWhere
          ? {
              traceScope: scopeTraceFilterToTable({
                table: def.table,
                filterWhere,
                isLiveWindow: params.timeRange.live === true,
              }),
            }
          : {}),
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

  async discoverRange({
    def,
    params,
    filterWhere,
  }: {
    def: RangeFacetDef;
    params: DiscoverParams;
    filterWhere?: TraceFilterWhere;
  }): Promise<RangeFacetDescriptor> {
    const result = await this.repository.findRangeStatsForTable({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      table: def.table,
      timeColumn: ClickHouseFacetRegistryAdapter.TABLE_TIME_COLUMNS[def.table],
      column: def.expression,
      ...(filterWhere ? { filterWhere } : {}),
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

  async discoverDynamicKeys({
    def,
    params,
    limit,
  }: {
    def: FacetDefinition & { kind: "dynamic_keys" };
    params: DiscoverParams;
    limit: number;
  }): Promise<DynamicKeysFacetDescriptor> {
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
