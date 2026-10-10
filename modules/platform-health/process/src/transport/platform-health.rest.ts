/**
 * The monitoring-keyed `GET /api/v1/platform-health` family: the whole
 * platform, and each subsystem on its own path.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, documentedResponses, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  PlatformHealthApi,
  type PlatformHealthCheckName,
  platformHealthCheckNameSchema,
  platformHealthQuerySchema,
  type PlatformHealthReport,
  platformHealthReportSchema,
  PlatformHealthSubsystemNotFoundError,
  PlatformHealthUnhealthyError,
} from "@langwatch/platform-health-contract";
import { z } from "zod";

import { httpStatusForReport } from "../rules/platform-health-report.rules.ts";

const monitor = anyAuthenticated({
  reason:
    "PLATFORM_HEALTH_API_KEY is the bearer this door compares in constant time; a monitor is not a tenant, so no permission is asked. Where the key is unset the door answers 404, as though the family were not there.",
});

const ANSWERS =
  "An external monitor reads a status and a report: 200 healthy or degraded, 503 unhealthy, 401 unauthorized and 404 for a subsystem this platform does not have.";

export const platformHealthRest = defineRestRouter(PlatformHealthApi)
  .withNamespace("platform-health")
  .withVersion(MANAGEMENT_API_VERSION)
  // An external monitor's probe URL is configuration in someone else's system:
  // it is set once and never negotiated, so the family serves one generation
  // at the path it has.
  .withAddressing("v1-only")

  .get("/", "getPlatformHealth")
  .withQuery(platformHealthQuerySchema)
  .withCredential("internal_secret")
  .withAccess(monitor)
  .withOutput(platformHealthReportSchema)
  .withDocs({
    summary: "Report whether the platform is working",
    description: ANSWERS,
    responses: documentedResponses({ 503: platformHealthReportSchema }),
  })
  .handle(async ({ app, input, signal }) => answer(await app.checkAll({ ...input, signal })))

  .get("/:check", "getPlatformHealthSubsystem")
  .withParams(z.object({ check: z.string() }))
  .withQuery(platformHealthQuerySchema)
  .withCredential("internal_secret")
  .withAccess(monitor)
  .withOutput(platformHealthReportSchema)
  .withDocs({
    summary: "Report whether one subsystem is working",
    description: ANSWERS,
    responses: documentedResponses({ 503: platformHealthReportSchema }),
  })
  .handle(async ({ app, input, signal }) =>
    answer(
      await app.checkOne(subsystem(input.check), {
        triggerId: input.triggerId,
        workflowId: input.workflowId,
        signal,
      }),
    ),
  )
  .build();

/** The subsystem the path named, refused where this platform has no such one. */
function subsystem(name: string): PlatformHealthCheckName {
  const check = platformHealthCheckNameSchema.safeParse(name);
  if (!check.success) throw new PlatformHealthSubsystemNotFoundError();

  return check.data;
}

/**
 * A failing platform answers a failure, which the family's own boundary
 * renders from the report; degraded is still served as a success.
 */
function answer(report: PlatformHealthReport): PlatformHealthReport {
  if (httpStatusForReport(report.status) === 503) throw new PlatformHealthUnhealthyError(report);

  return report;
}
