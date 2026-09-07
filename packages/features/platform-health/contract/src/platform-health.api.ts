import { featureApi } from "@langwatch/runtime-composition/contract";
import type {
  PlatformHealthCheckName,
  PlatformHealthQuery,
  PlatformHealthReport,
} from "./platform-health.ts";

/** The callable platform-health capability a process transport reaches. */
export interface PlatformHealthApi {
  checkAll(query: PlatformHealthQuery): Promise<PlatformHealthReport>;
  checkOne(
    name: PlatformHealthCheckName,
    query: PlatformHealthQuery,
  ): Promise<PlatformHealthReport>;
  /**
   * Whether the presented key is this deployment's monitoring key. The answer
   * is a boolean because the transport owns the refusal it turns into.
   */
  acceptsKey(presented: string | null | undefined): boolean;
}

export const PlatformHealthApi = featureApi<PlatformHealthApi>("platform-health");
