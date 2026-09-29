import { StatusDot } from "@langwatch/design-system-internal";

import { formatClock } from "./format.ts";

/** Whether the page is still hearing from the daemon: the hub's old heartbeat dot. */
export const Connection = ({
  error,
  updatedAt,
}: {
  error: string | undefined;
  updatedAt: number | undefined;
}) => {
  if (error !== undefined) return <StatusDot state="down" label="Daemon unreachable, retrying" />;
  if (updatedAt === undefined) return <StatusDot state="starting" label="Connecting" />;
  return <StatusDot state="live" label={`Live, updated ${formatClock({ at: updatedAt })}`} />;
};
