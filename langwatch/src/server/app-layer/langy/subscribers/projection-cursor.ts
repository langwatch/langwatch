import type { Event } from "~/server/event-sourcing/domain/types";
import type { ProjectionCursor } from "~/server/event-sourcing/projections/stateProjection.types";

export function projectionCursorHasReachedEvent(
  cursor: ProjectionCursor,
  event: Event,
): boolean {
  return (
    cursor.acceptedAt > event.createdAt ||
    (cursor.acceptedAt === event.createdAt && cursor.eventId >= event.id)
  );
}

export function projectionNotReadyError(params: {
  projectionName: string;
  eventId: string;
}): Error {
  return new Error(
    `${params.projectionName} has not projected event ${params.eventId} yet`,
  );
}
