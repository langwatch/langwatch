/**
 * `/api/health/{collector,evaluations,processor,triggers,workflows,scenarios,langy}` - the
 * project-keyed probes an orchestrator points at, answering main's bodies at main's statuses.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import type { LangyKeyCaller } from "@langwatch/langy-contract";
import {
  healthProbeHeadersSchema,
  platformHealthQuerySchema,
  scenarioCanaryQuerySchema,
  type ProjectKeyedProbeRequest,
} from "@langwatch/platform-health-contract";

/** The operations the probe doors reach. */
export interface PlatformHealthProbeApi {
  probeWithProjectKey(request: ProjectKeyedProbeRequest): Promise<Response>;
  probeLangy(key: LangyKeyCaller): Promise<Response>;
}

export const PlatformHealthProbeApi = moduleApi<PlatformHealthProbeApi>()("platform-health");

const canary = publicRoute({
  reason:
    "a project key presented as X-Auth-Token or Authorization: Bearer is resolved by the probe itself, as main's did, and forwarded to the canaries it runs",
});

const FORWARDED = {
  produces: "application/json",
  because: "Main's probe answers carry the canary's own status inside a 200 or a flat message.",
} as const;

export const platformHealthProbeRest = defineRestRouter(PlatformHealthProbeApi)
  .withNamespace("health")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .get("/api/health/collector", "probeCollectorHealth")
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, response }, headers) =>
    response.pass(await app.probeWithProjectKey({ check: "collector", headers })),
  )

  .get("/api/health/evaluations", "probeEvaluationsHealth")
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, response }, headers) =>
    response.pass(await app.probeWithProjectKey({ check: "evaluations", headers })),
  )

  .get("/api/health/processor", "probeProcessorHealth")
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, response }, headers) =>
    response.pass(await app.probeWithProjectKey({ check: "processor", headers })),
  )

  .get("/api/health/triggers", "probeTriggersHealth")
  .withQuery(platformHealthQuerySchema)
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, input, response }, headers) =>
    response.pass(
      await app.probeWithProjectKey({
        check: "triggers",
        headers,
        triggerId: input.triggerId,
      }),
    ),
  )

  .get("/api/health/workflows", "probeWorkflowsHealth")
  .withQuery(platformHealthQuerySchema)
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, input, response }, headers) =>
    response.pass(
      await app.probeWithProjectKey({
        check: "workflows",
        headers,
        workflowId: input.workflowId,
      }),
    ),
  )

  .get("/api/health/scenarios", "probeScenariosHealth")
  .withQuery(scenarioCanaryQuerySchema)
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, input, response }, headers) =>
    response.pass(
      await app.probeWithProjectKey({ check: "scenarios", headers, runPlanId: input.runPlanId }),
    ),
  )
  .build();

const LANGY_ANSWERS = {
  produces: ["application/json", "text/plain;charset=UTF-8"],
  because:
    "Main's Langy probe answers its canary status as JSON, and a dark surface as a plain 404.",
} as const;

/** `/api/health/langy`: the key's owner sends one greeting turn, refused as langy's turns are. */
export const platformHealthLangyProbeRest = defineRestRouter(PlatformHealthProbeApi)
  .withNamespace("health")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  .get("/api/health/langy", "probeLangyHealth")
  .withPermission("langy:create")
  .withResponse("forwarded", LANGY_ANSWERS)
  .withDocs({ hide: true })
  .handle(async ({ app, actor, scope, response }) =>
    response.pass(await app.probeLangy({ actor, projectId: scope.id })),
  )
  .build();
