import { Config, posthogHost, posthogKey, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/** The PostHog target is shared deployment config: the same leaves ops reads. */
export const nurturingConfig = Config.define((c) => ({
  /** Customer.io's data centre; the channel sends to the EU one unless this names "us". */
  customerIoRegion: c.env("CUSTOMER_IO_REGION", z.enum(["us", "eu"]).optional()),
  /** Replaces the regional CDP endpoint, e.g. a local analyticssim; absent, the vendor's. */
  customerIoBaseUrl: c.env("CUSTOMER_IO_BASE_URL", z.string().min(1).optional()),
  posthogKey,
  posthogHost,
}));

export type NurturingServerConfig = ConfigOf<typeof nurturingConfig>;
