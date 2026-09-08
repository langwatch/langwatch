import { HandledError } from "@langwatch/handled-error";

import type { PlatformHealthReport } from "./platform-health.ts";

/**
 * The monitoring key was absent or wrong. Deliberately says nothing about
 * which: a monitor holds one key, and telling a caller which half of the
 * check failed is an oracle nobody legitimate needs.
 */
export class PlatformHealthUnauthorizedError extends HandledError {
  declare readonly code: "platform_health_unauthorized";

  constructor() {
    super("platform_health_unauthorized", "The platform health key was not accepted.", {
      httpStatus: 401,
    });
    this.name = "PlatformHealthUnauthorizedError";
  }
}

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
