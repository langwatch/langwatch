/** Main's ceiling for one relayed scenario turn when none usable is configured: 15 minutes. */
export const RELAY_TURN_CEILING_DEFAULT_MS = 900_000;

/** A positive whole number of milliseconds is honoured; anything else clamps, never refuses. */
export function relayTurnCeilingMs({ configured }: { configured: number | undefined }): number {
  if (configured === undefined || !Number.isInteger(configured) || configured <= 0) {
    return RELAY_TURN_CEILING_DEFAULT_MS;
  }
  return configured;
}
