import type {
  PlatformHealthCheckName,
  PlatformHealthQuery,
  PlatformHealthReport,
} from "./platform-health.ts";

/**
 * The capability the platform-health surface is built on: run the probes and
 * say what they reported.
 */
export abstract class PlatformHealthService {
  abstract checkAll(query: PlatformHealthQuery): Promise<PlatformHealthReport>;
  abstract checkOne(
    name: PlatformHealthCheckName,
    query: PlatformHealthQuery,
  ): Promise<PlatformHealthReport>;
}
