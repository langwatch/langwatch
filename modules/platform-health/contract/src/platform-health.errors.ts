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
