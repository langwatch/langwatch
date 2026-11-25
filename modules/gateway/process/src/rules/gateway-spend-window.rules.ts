import { GatewaySpendWindowInvertedError, GatewayWindow } from "@langwatch/gateway-contract";
import { Temporal, type Instant } from "@langwatch/time";

/** A key's spend window in epoch milliseconds, defaulting to the current UTC month to date. */
export function resolveVirtualKeySpendWindow({
  from,
  to,
  now,
}: {
  from: number | undefined;
  to: number | undefined;
  now: Instant;
}): { fromDate: Instant; toDate: Instant } {
  const fromDate =
    from !== undefined
      ? Temporal.Instant.fromEpochMilliseconds(from)
      : GatewayWindow.startOfCurrentMonthUTC(now);
  const toDate = to !== undefined ? Temporal.Instant.fromEpochMilliseconds(to) : now;
  if (fromDate.epochMilliseconds >= toDate.epochMilliseconds) {
    throw new GatewaySpendWindowInvertedError();
  }
  return { fromDate, toDate };
}
