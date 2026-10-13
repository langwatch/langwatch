import { HandledError } from "@langwatch/handled-error";

import type { PlatformHealthReport } from "./platform-health.ts";

/**
 * The path named a subsystem this platform does not have. The five names are
 * fixed at release, so the caller's own URL is what it can act on.
 */
export class PlatformHealthSubsystemNotFoundError extends HandledError {
  declare readonly code: "platform_health_subsystem_not_found";

  constructor() {
    super("platform_health_subsystem_not_found", "No such subsystem.", {
      httpStatus: 404,
    });
    this.name = "PlatformHealthSubsystemNotFoundError";
  }
}

/**
 * The platform itself is not working: this is the family's answer rather than
 * a failure of the family, so it carries the report the monitor came to read.
 */
export class PlatformHealthUnhealthyError extends HandledError {
  declare readonly code: "platform_health_unhealthy";

  readonly report: PlatformHealthReport;

  constructor(report: PlatformHealthReport) {
    super("platform_health_unhealthy", "One or more platform subsystems are not healthy.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "PlatformHealthUnhealthyError";
    this.report = report;
  }
}

/** Which boundary a canary was sent through. */
export type CanaryTransport = "rest" | "otlp";

/**
 * A canary round trip did not complete, which is the platform's fault: the
 * probes answer external monitors. `meta` is customer-visible, so it names
 * only the probe, transport and upstream status; the cause goes in the log.
 */
export class HealthCheckFailedError extends HandledError {
  declare readonly code: "health_check_failed";

  constructor({
    probe,
    transport,
    upstreamStatus,
    reasons,
  }: {
    probe: string;
    transport?: CanaryTransport;
    upstreamStatus?: number;
    reasons?: readonly Error[];
  }) {
    super("health_check_failed", "The health check could not complete.", {
      httpStatus: 500,
      fault: "platform",
      meta: {
        check: probe,
        ...(transport !== undefined ? { transport } : {}),
        ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
      },
      ...(reasons ? { reasons } : {}),
    });
    this.name = "HealthCheckFailedError";
  }
}
