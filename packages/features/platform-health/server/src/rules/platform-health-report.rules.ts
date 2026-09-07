import type {
  PlatformHealthCheck,
  PlatformHealthStatus,
} from "@langwatch/platform-health-contract";

/**
 * The one word a monitor alerts on. A subsystem pointed nowhere is degraded,
 * not unhealthy: paging on it would page on our own configuration.
 */
export function rollUpStatus(checks: readonly PlatformHealthCheck[]): PlatformHealthStatus {
  if (checks.some((check) => check.status === "unhealthy")) return "unhealthy";
  if (checks.some((check) => check.status === "not_configured")) return "degraded";
  return "healthy";
}

/** Only a failing platform answers a failing status; degraded is still served. */
export function httpStatusForReport(status: PlatformHealthStatus): 200 | 503 {
  return status === "unhealthy" ? 503 : 200;
}
