import type { TelemetryStatus } from "./telemetry-api.ts";

/** Every view reads the console's one status poll rather than polling it again. */
export type ViewProps = {
  status?: TelemetryStatus;
  error?: Error;
  refresh: () => Promise<void>;
};
