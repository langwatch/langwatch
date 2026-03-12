import "../services/dejaview/env-defaults.ts";
import { Router } from "express";
import {
  loadEvents,
  listRecentAggregates,
  searchAggregates,
  queryChildAggregates,
  type DejaViewEvent,
} from "../services/dejaview/clickhouse.ts";
import type {
  DiscoveredProjection,
  DiscoveredEventHandler,
} from "../services/dejaview/pipelineDiscovery.ts";

// Pipeline discovery happens once at startup.
// It may fail in production (pipeline files not available) — that's OK,
// the UI still shows raw events.
let projections: DiscoveredProjection[] = [];
let handlers: DiscoveredEventHandler[] = [];
let pipelineAggregateTypes: Record<string, string> = {};
let discoveryDone = false;

async function ensureDiscovery() {
  if (discoveryDone) return;
  discoveryDone = true;
  try {
    const mod = await import("../services/dejaview/pipelineDiscovery.ts");
    [projections, handlers, pipelineAggregateTypes] = await Promise.all([
      mod.discoverProjections(),
      mod.discoverEventHandlers(),
      mod.buildPipelineAggregateTypeMap(),
    ]);
    console.log(
      `Deja View: discovered ${projections.length} projections, ${handlers.length} handlers`
    );
  } catch (error) {
    console.warn(
      "Deja View: pipeline discovery unavailable (events will still load):",
      error instanceof Error ? error.message : error
    );
  }
}

/** Build metadata about discovered projections/handlers (no state computation). */
function getProjectionMeta() {
  return projections.map((p) => ({
    id: p.id,
    pipelineName: p.pipelineName,
    projectionName: p.projectionName,
    eventTypes: [...p.definition.eventTypes],
    aggregateType: pipelineAggregateTypes[p.pipelineName],
  }));
}

function getHandlerMeta() {
  return handlers.map((h) => ({
    id: h.id,
    pipelineName: h.pipelineName,
    handlerName: h.handlerName,
    eventTypes: [...(h.eventTypes ?? h.definition.eventTypes)],
  }));
}

/** Compute a single projection's state at a given cursor, returning one snapshot per step. */
function computeProjectionAtCursor({
  events,
  projection,
  cursor,
}: {
  events: DejaViewEvent[];
  projection: DiscoveredProjection;
  cursor: number;
}) {
  const fold = projection.definition;
  const expectedAggregateType = pipelineAggregateTypes[projection.pipelineName];
  const stateByAggregate: Record<string, { state: unknown; tenantId: string }> = {};

  const limit = Math.min(cursor + 1, events.length);
  for (let i = 0; i < limit; i++) {
    const event = events[i]!;
    const matches = !expectedAggregateType || event.aggregateType === expectedAggregateType;
    if (!matches) continue;

    if (!stateByAggregate[event.aggregateId]) {
      stateByAggregate[event.aggregateId] = {
        state: fold.init(),
        tenantId: String(event.tenantId),
      };
    }

    const entry = stateByAggregate[event.aggregateId]!;
    if (fold.eventTypes.includes(event.type)) {
      entry.state = fold.apply(entry.state, event);
    }
  }

  return Object.entries(stateByAggregate).map(([aggregateId, { state, tenantId }]) => ({
    aggregateId,
    tenantId,
    data: state,
  }));
}

export function createDejaViewRouter(): Router {
  const router = Router();

  // List recent aggregates
  router.get("/api/dejaview/aggregates", async (_req, res) => {
    try {
      const limit = parseInt(String(_req.query.limit ?? "50"), 10);
      const query = String(_req.query.q ?? "");

      const aggregates = query
        ? await searchAggregates(query, limit)
        : await listRecentAggregates(limit);

      res.json({ aggregates });
    } catch (error) {
      console.error("Failed to list aggregates:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Replay events for an aggregate — returns events + metadata (no heavy state computation)
  router.get("/api/dejaview/replay/:aggregateId", async (req, res) => {
    try {
      const { aggregateId } = req.params;
      if (!aggregateId) {
        res.status(400).json({ error: "aggregateId is required" });
        return;
      }

      // Ensure pipeline discovery has been attempted
      await ensureDiscovery();

      // Load events
      let events = await loadEvents(aggregateId);

      if (events.length === 0) {
        res.json({ events: [], projections: [], handlers: [], pipelineAggregateTypes: {} });
        return;
      }

      // Discover links and load child aggregate events
      const aggregateType = events[0]?.aggregateType;
      let childAggregateIds: string[] = [];

      if (aggregateType) {
        try {
          const mod = await import("../services/dejaview/pipelineDiscovery.ts");
          const linkMap = await mod.discoverLinks();
          const linkInfo = linkMap.get(aggregateType);

          if (linkInfo) {
            for (const childLink of linkInfo.childLinks) {
              try {
                const childIds = await queryChildAggregates({
                  parentId: aggregateId,
                  childAggregateType: childLink.toAggregateType,
                });
                childAggregateIds.push(...childIds);

                const childEventArrays = await Promise.all(
                  childIds.map((id) => loadEvents(id).catch(() => [] as DejaViewEvent[]))
                );
                for (const childEvents of childEventArrays) {
                  events.push(...childEvents);
                }
              } catch {
                // Skip failed child queries
              }
            }
          }
        } catch {
          // Links unavailable — continue without children
        }
      }

      // Sort all events by timestamp
      events.sort((a, b) => a.timestamp - b.timestamp);

      res.json({
        events,
        projections: getProjectionMeta(),
        handlers: getHandlerMeta(),
        pipelineAggregateTypes,
        childAggregateIds,
      });
    } catch (error) {
      console.error("Failed to replay aggregate:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Compute projection state at a specific cursor position
  router.get("/api/dejaview/replay/:aggregateId/projection/:projectionId", async (req, res) => {
    try {
      const { aggregateId, projectionId } = req.params;
      const cursor = parseInt(String(req.query.cursor ?? "0"), 10);

      await ensureDiscovery();

      const projection = projections.find((p) => p.id === projectionId);
      if (!projection) {
        res.status(404).json({ error: `Projection ${projectionId} not found` });
        return;
      }

      const events = await loadEvents(aggregateId);
      events.sort((a, b) => a.timestamp - b.timestamp);

      const state = computeProjectionAtCursor({ events, projection, cursor });
      res.json({ projectionId, cursor, state });
    } catch (error) {
      console.error("Failed to compute projection state:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  return router;
}
