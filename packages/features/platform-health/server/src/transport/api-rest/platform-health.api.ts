/**
 * The monitoring-keyed `GET /api/v1/platform-health` family: the whole
 * platform, and each subsystem on its own path.
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  type AppRestSecurity,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type ServiceContext,
} from "@langwatch/api/rest";
import {
  type PlatformHealthApi,
  type PlatformHealthQuery,
  type PlatformHealthReport,
  platformHealthCheckNameSchema,
  PlatformHealthUnauthorizedError,
} from "@langwatch/platform-health-contract";
import { z } from "zod";

import { httpStatusForReport } from "../../rules/platform-health-report.rules.ts";

/** What the family needs from the process it is mounted in. */
export interface PlatformHealthRestPorts {
  /** The process's platform-health capability. */
  platformHealth: () => PlatformHealthApi;
}

/** `GET /api/v1/platform-health[/:check]`, bound to one process. */
export function createPlatformHealthRestApp(options: {
  security: AppRestSecurity;
  ports: PlatformHealthRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const { service, policy } = security.createServiceVersionedApp({
    name: "platform-health",
    basePath: "/api",
    // An external monitor's probe URL is configuration in someone else's
    // system: it is set once and never negotiated, so the family serves one
    // generation at the path it has.
    staticGeneration: "v1",
  });

  const monitor = policy(
    handlerManagedAuth({
      reason:
        "PLATFORM_HEALTH_API_KEY presented as a bearer token and compared in constant time; a missing or wrong key returns 401 before any probe runs. The family is not mounted at all where the key is unset.",
      // A deployment-wide monitoring secret, not an RBAC permission.
      permissions: [],
      credential: "internal",
    }),
  );

  const checkParamsSchema = z.object({ check: z.string() });

  const rawResponse =
    "an external monitor reads a status and a report: 200 healthy or degraded, 503 unhealthy, 401 unauthorized and 404 for a subsystem this platform does not have";

  return service
    .registerRoute(
      "get",
      "/platform-health",
      MANAGEMENT_API_VERSION,
      async (c: ServiceContext<EndpointVariables>) => {
        const health = authorized(c, ports);
        return answer(c, await health.checkAll(query(c)));
      },
      (b) => monitor(b).withRawResponse(rawResponse),
    )
    .registerRoute(
      "get",
      "/platform-health/:check",
      MANAGEMENT_API_VERSION,
      async (c: ServiceContext<EndpointVariables>) => {
        const health = authorized(c, ports);
        const check = platformHealthCheckNameSchema.safeParse(c.req.param("check"));
        if (!check.success) {
          return c.json({ message: "No such subsystem." }, 404);
        }
        return answer(c, await health.checkOne(check.data, query(c)));
      },
      (b) => monitor(b).withParams(checkParamsSchema).withRawResponse(rawResponse),
    )
    .build();
}

/** The capability, once the monitoring key has been accepted. */
function authorized(
  c: ServiceContext<EndpointVariables>,
  ports: PlatformHealthRestPorts,
): PlatformHealthApi {
  const health = ports.platformHealth();
  const presented = bearerToken(c.req.header("authorization"));
  const accepted = health.acceptsKey(presented);
  if (!accepted) {
    throw new PlatformHealthUnauthorizedError();
  }
  return health;
}

function answer(c: ServiceContext<EndpointVariables>, report: PlatformHealthReport): Response {
  return c.json(report, httpStatusForReport(report.status));
}

function query(c: ServiceContext<EndpointVariables>): PlatformHealthQuery {
  return {
    triggerId: c.req.query("triggerId"),
    workflowId: c.req.query("workflowId"),
  };
}

function bearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1]?.trim() ?? null;
}
