import type {
  EventExplorerRepository,
  AggregateSearchResult,
} from "./repositories/event-explorer.repository";
import {
  getProjectionMetadata,
  getDejaViewProjections,
} from "~/server/event-sourcing/pipelineRegistry";

export class EventExplorerService {
  constructor(readonly repo: EventExplorerRepository) {}

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
    const allProjections = getProjectionMetadata();
    const selected = allProjections.filter((p) =>
      params.projectionNames.includes(p.projectionName),
    );

    if (selected.length === 0) {
      return { projections: [] };
    }

    const aggregateTypes = [
      ...new Set(selected.map((p) => p.aggregateType)),
    ];
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

    const projections: Array<{
      projectionName: string;
      aggregateCount: number;
      tenantBreakdown: Array<{
        tenantId: string;
        aggregateCount: number;
      }>;
    }> = [];

    for (const projection of selected) {
      const tenantBreakdown =
        byAggregateType.get(projection.aggregateType) ?? [];
      const aggregateCount = tenantBreakdown.reduce(
        (sum, t) => sum + t.aggregateCount,
        0,
      );
      projections.push({
        projectionName: projection.projectionName,
        aggregateCount,
        tenantBreakdown,
      });
    }

    return { projections };
  }

  async searchAggregates(params: {
    query: string;
    tenantIds: string[];
  }): Promise<AggregateSearchResult[]> {
    return this.repo.searchAggregates({
      query: params.query,
      tenantIds: params.tenantIds.length > 0 ? params.tenantIds : undefined,
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

  async computeProjectionState(params: {
    aggregateId: string;
    tenantId: string;
    projectionName: string;
    eventIndex: number;
  }): Promise<{
    state: unknown;
    appliedEventCount: number;
    projectionName: string;
    aggregateType: string;
  }> {
    const projections = getProjectionMetadata();
    const projection = projections.find(
      (p) => p.projectionName === params.projectionName,
    );

    if (!projection) {
      return {
        state: null,
        appliedEventCount: 0,
        projectionName: params.projectionName,
        aggregateType: "",
      };
    }

    const limit = params.eventIndex + 1;
    const rows = await this.repo.findEventsByAggregate({
      aggregateId: params.aggregateId,
      tenantId: params.tenantId,
      limit,
    });

    const dejaViewProjections = getDejaViewProjections();
    const dejaViewProj = dejaViewProjections.find(
      (p) => p.projectionName === params.projectionName,
    );

    if (!dejaViewProj) {
      return {
        state: null,
        appliedEventCount: rows.length,
        projectionName: params.projectionName,
        aggregateType: projection.aggregateType,
      };
    }

    let state = dejaViewProj.init();
    let appliedCount = 0;
    for (const row of rows) {
      let parsedPayload: unknown;
      try {
        parsedPayload =
          typeof row.payload === "string"
            ? JSON.parse(row.payload)
            : row.payload;
      } catch {
        parsedPayload = {};
      }
      const timestampMs = parseInt(row.eventTimestamp, 10);
      const event = {
        id: row.eventId,
        aggregateId: params.aggregateId,
        aggregateType: projection.aggregateType,
        tenantId: params.tenantId,
        createdAt: timestampMs,
        occurredAt: timestampMs,
        type: row.eventType,
        version: "",
        data: parsedPayload,
      };
      if (dejaViewProj.eventTypes.includes(row.eventType)) {
        try {
          state = dejaViewProj.apply(state, event);
          appliedCount++;
        } catch {
          // skip events that fail to apply
        }
      }
    }

    return {
      state,
      appliedEventCount: appliedCount,
      projectionName: params.projectionName,
      aggregateType: projection.aggregateType,
    };
  }
}
