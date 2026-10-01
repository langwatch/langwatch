import { moduleApi } from "@langwatch/kernel/module-api";

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
  /**
   * Whether the presented key is this deployment's monitoring key. The answer
   * is a boolean because the transport owns the refusal it turns into.
   */
  acceptsKey(presented: string | null | undefined): boolean;
}

export const PlatformHealthApi = moduleApi<PlatformHealthApi>()("platform-health");
