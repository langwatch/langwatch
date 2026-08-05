// The cursor comparison itself lives in @langwatch/langy (cursorHasReachedEvent)
// — ONE byte-wise comparator shared with the browser fold (ADR-059). This module
// keeps only the server-side operational helper.
export function projectionNotReadyError(params: {
  projectionName: string;
  eventId: string;
}): Error {
  return new Error(
    `${params.projectionName} has not projected event ${params.eventId} yet`,
  );
}
