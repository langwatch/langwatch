import { moduleApi } from "@langwatch/module";

import type {
  PlatformHealthCheckName,
  PlatformHealthQuery,
  PlatformHealthReport,
} from "./platform-health.ts";

/** The callable platform-health capability a process transport reaches. */
/** A report's query, and the caller's request so the probes stop when it goes away. */
export type PlatformHealthCheckInput = PlatformHealthQuery &
  Readonly<{ signal: AbortSignal | undefined }>;

export interface PlatformHealthApi {
  checkAll(query: PlatformHealthCheckInput): Promise<PlatformHealthReport>;
  checkOne(
    name: PlatformHealthCheckName,
    query: PlatformHealthCheckInput,
  ): Promise<PlatformHealthReport>;
}

export const PlatformHealthApi = moduleApi<PlatformHealthApi>()("platform-health");
