/**
 * The monitoring-keyed `GET /api/v1/platform-health` family: the whole
 * platform, and each subsystem on its own path.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  PlatformHealthApi,
  type PlatformHealthApi as PlatformHealthCapability,
  type PlatformHealthCheckName,
  platformHealthCheckNameSchema,
  platformHealthQuerySchema,
  type PlatformHealthReport,
  platformHealthReportSchema,
  PlatformHealthSubsystemNotFoundError,
  PlatformHealthUnauthorizedError,
  PlatformHealthUnhealthyError,
} from "@langwatch/platform-health-contract";
import { z } from "zod";

import { httpStatusForReport } from "../rules/platform-health-report.rules.ts";

/**
 * The `Authorization` header, as the process read it. The family resolves no
 * credential of its own — a monitor is not a tenant — and compares the
 * monitoring key itself instead.
 */
export const platformHealthAuthorization = defineRestMiddleware(
  "platformHealthAuthorization",
  z.string().nullable(),
);

const monitor = publicRoute({
  reason:
    "PLATFORM_HEALTH_API_KEY presented as a bearer token and compared in constant time by the route itself; a missing or wrong key is refused before any probe runs. The family is not mounted at all where the key is unset.",
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
  .withAccess(monitor)
  .withMiddleware(platformHealthAuthorization)
  .withOutput(platformHealthReportSchema)
  .withDocs({
    summary: "Report whether the platform is working",
    description: ANSWERS,
    responses: documentedResponses({ 503: platformHealthReportSchema }),
  })
  .handle(async ({ app, input }, authorization) =>
    answer(await accepted(app, authorization).checkAll(input)),
  )

  .get("/:check", "getPlatformHealthSubsystem")
  .withParams(z.object({ check: z.string() }))
  .withQuery(platformHealthQuerySchema)
  .withAccess(monitor)
  .withMiddleware(platformHealthAuthorization)
  .withOutput(platformHealthReportSchema)
  .withDocs({
    summary: "Report whether one subsystem is working",
    description: ANSWERS,
    responses: documentedResponses({ 503: platformHealthReportSchema }),
  })
  .handle(async ({ app, input }, authorization) =>
    answer(
      await accepted(app, authorization).checkOne(subsystem(input.check), {
        triggerId: input.triggerId,
        workflowId: input.workflowId,
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

/** The capability, once the monitoring key has been accepted. */
function accepted(
  app: PlatformHealthCapability,
  authorization: string | null,
): PlatformHealthCapability {
  const accepts = app.acceptsKey(bearerToken(authorization));
  if (!accepts) throw new PlatformHealthUnauthorizedError();

  return app;
}

/**
 * A failing platform answers a failure, which the family's own boundary
 * renders from the report; degraded is still served as a success.
 */
function answer(report: PlatformHealthReport): PlatformHealthReport {
  if (httpStatusForReport(report.status) === 503) throw new PlatformHealthUnhealthyError(report);

  return report;
}

function bearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());

  return match?.[1]?.trim() ?? null;
}
