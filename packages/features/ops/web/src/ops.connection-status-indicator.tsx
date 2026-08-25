import { Status } from "@chakra-ui/react";
import { formatDurationMs } from "./formatters";
import { isSnapshotStale } from "./ops.snapshot-staleness";

export type OpsConnectionStatus = "connected" | "connecting" | "disconnected";

const colorMap: Record<OpsConnectionStatus, "green" | "orange" | "red"> = {
  connected: "green",
  connecting: "orange",
  disconnected: "red",
};
const labelMap: Record<OpsConnectionStatus, string> = {
  connected: "Live",
  connecting: "Connecting",
  disconnected: "Disconnected",
};

/**
 * Connection state AND snapshot age, because either alone can lie (ADR-090).
 *
 * The connection is between this browser and its own pod, and it stays happily
 * "Live" while the numbers behind it rot: the fleet's writer can die and leave
 * the lease unclaimed for a window, or a detail cycle can stall, and every pod
 * — including this one — keeps serving the last snapshot it read. A viewer
 * would see a green light over stale data with nothing to distinguish it from
 * a healthy page. Age is the only signal that separates the two.
 */
export function ConnectionStatusIndicator({
  status,
  computedAtMs,
  now = Date.now(),
}: {
  status: OpsConnectionStatus;
  /** When the snapshot behind this page was computed, in ms. Null when unknown. */
  computedAtMs?: number | null;
  now?: number;
}) {
  // A stale snapshot outranks a healthy socket: the connection being fine is
  // exactly what makes the stale numbers misleading.
  if (isSnapshotStale({ computedAtMs, now })) {
    return (
      <Status.Root size="sm" colorPalette="orange">
        <Status.Indicator />
        {`Last updated ${formatDurationMs(now - computedAtMs!)} ago`}
      </Status.Root>
    );
  }

  return (
    <Status.Root size="sm" colorPalette={colorMap[status]}>
      <Status.Indicator />
      {labelMap[status]}
    </Status.Root>
  );
}
