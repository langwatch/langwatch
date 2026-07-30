import type { Registry } from "@langwatch/event-sourcing";
import type {
  AggregateSearchResult,
  EventExplorerRepository,
} from "./repositories/event-explorer.repository";

/** One fold or map, and the aggregate type whose events it is mounted on. */
interface ProjectionRef {
  projectionName: string;
  aggregateType: string;
}

export class EventExplorerService {
  constructor(
    readonly repo: EventExplorerRepository,
    private readonly registry: Registry,
  ) {}

  /**
   * Every fold and map registered, with its owning pipeline. A pipeline is
   * registered under its aggregate type, so the pipeline name is the aggregate
   * type — there is no second mapping to keep in step.
   */
  private projections(): ProjectionRef[] {
    return this.registry
      .all()
      .flatMap(({ pipeline, aggregateType }) =>
        [...Object.keys(pipeline.folds), ...Object.keys(pipeline.maps)].map(
          (projectionName) => ({ projectionName, aggregateType }),
        ),
      );
  }

  async discoverAggregates(params: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
  }): Promise<{
    projections: Array<{
      projectionName: string;
      aggregateCount: number;
      tenantBreakdown: Array<{
        tenantId: string;
        aggregateCount: number;
      }>;
    }>;
  }> {
    const selected = this.projections().filter((projection) =>
      params.projectionNames.includes(projection.projectionName),
    );

    if (selected.length === 0) {
      return { projections: [] };
    }

    const aggregateTypes = [...new Set(selected.map((p) => p.aggregateType))];
    const sinceMs = new Date(params.since).getTime();

    const rows = await this.repo.findAggregates({
      aggregateTypes,
      sinceMs,
      tenantIds: params.tenantIds.length > 0 ? params.tenantIds : undefined,
    });

    const byAggregateType = new Map<
      string,
      Array<{ tenantId: string; aggregateCount: number }>
    >();
    for (const row of rows) {
      const list = byAggregateType.get(row.aggregateType) ?? [];
      list.push({
        tenantId: row.tenantId,
        aggregateCount: row.aggregateCount,
      });
      byAggregateType.set(row.aggregateType, list);
    }

    return {
      projections: selected.map((projection) => {
        const tenantBreakdown =
          byAggregateType.get(projection.aggregateType) ?? [];
        return {
          projectionName: projection.projectionName,
          aggregateCount: tenantBreakdown.reduce(
            (sum, tenant) => sum + tenant.aggregateCount,
            0,
          ),
          tenantBreakdown,
        };
      }),
    };
  }

  async searchAggregates(params: {
    query: string;
    tenantIds: string[];
    sinceMs?: number;
  }): Promise<AggregateSearchResult[]> {
    return this.repo.searchAggregates({
      query: params.query,
      tenantIds: params.tenantIds.length > 0 ? params.tenantIds : undefined,
      sinceMs: params.sinceMs,
    });
  }

  async getAggregateEvents(params: {
    aggregateId: string;
    tenantId: string;
    limit: number;
  }): Promise<
    Array<{
      eventId: string;
      eventType: string;
      eventTimestamp: string;
      payload: unknown;
    }>
  > {
    const rows = await this.repo.findEventsByAggregate(params);

    return rows.map((row) => {
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(row.payload);
      } catch {
        parsedPayload = row.payload;
      }
      return {
        eventId: row.eventId,
        eventType: row.eventType,
        eventTimestamp: row.eventTimestamp,
        payload: parsedPayload,
      };
    });
  }
}
