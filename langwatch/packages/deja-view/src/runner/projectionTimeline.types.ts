import type { Event } from "../../../../src/server/event-sourcing/domain/types";
import type { DiscoveredProjection } from "../discovery/projections.types";

/**
 * Grouped projection timeline types, exported as a single symbol per file.
 *
 * @example
 * type Timeline = ProjectionTimelineTypes[\"Timeline\"];
 */
export type ProjectionTimelineTypes = {
  Snapshot: {
    aggregateId: string;
    tenantId: string;
    version: string;
    data: unknown;
  };
  Step: {
    eventIndex: number;
    eventId: string;
    eventType: string;
    stale: boolean;
    projectionStateByAggregate: ProjectionTimelineTypes["Snapshot"][];
  };
  Timeline: {
    projection: DiscoveredProjection;
    steps: ProjectionTimelineTypes["Step"][];
  };
  Input: {
    events: Event[];
    projections: DiscoveredProjection[];
  };
};
