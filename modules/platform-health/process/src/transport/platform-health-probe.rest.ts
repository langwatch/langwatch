/**
 * `/api/health/{collector,evaluations,processor,triggers,workflows,scenarios,langy}` - the
 * project-keyed probes an orchestrator points at, answering main's bodies at main's statuses.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import type { LangyKeyCaller } from "@langwatch/langy-contract";
import { moduleApi } from "@langwatch/module";
import {
  healthProbeHeadersSchema,
  platformHealthQuerySchema,
  scenarioCanaryQuerySchema,
  type ProjectKeyedProbeRequest,
} from "@langwatch/platform-health-contract";

import type { LangyProbeAnswer, ProjectKeyedProbeAnswer } from "../rules/probe-answers.rules.ts";

/** The operations the probe doors reach. */
interface PlatformHealthProbeApi {
  probeWithProjectKey(request: ProjectKeyedProbeRequest): Promise<ProjectKeyedProbeAnswer>;
  probeLangy(key: LangyKeyCaller): Promise<LangyProbeAnswer>;
}

/** A canary answer no cache may keep: a monitor must see each run's real result. */
const NO_STORE = { "Cache-Control": "no-store" };

/** A project-keyed probe's answer as the HTTP response: its body as JSON at its status. */
export function projectKeyedProbeResponseOf(answer: ProjectKeyedProbeAnswer): Response {
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: { "Content-Type": "application/json", ...(answer.noStore ? NO_STORE : {}) },
  });
}

/**
 * The Langy probe's answer as the HTTP response. A dark surface is Hono's own 404, byte-for-byte
 * what an unmounted path returns, so it reveals nothing; a canary answer is uncacheable JSON.
 */
export function langyProbeResponseOf(answer: LangyProbeAnswer): Response {
  if (answer.kind === "dark") {
    return new Response("404 Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    });
  }
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

const PlatformHealthProbeApi = moduleApi<PlatformHealthProbeApi>()("platform-health");

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
  .handle(async ({ app, response, signal }, headers) =>
    response.pass(
      projectKeyedProbeResponseOf(
        await app.probeWithProjectKey({ check: "collector", headers, signal }),
      ),
    ),
  )

  .get("/api/health/evaluations", "probeEvaluationsHealth")
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, response, signal }, headers) =>
    response.pass(
      projectKeyedProbeResponseOf(
        await app.probeWithProjectKey({ check: "evaluations", headers, signal }),
      ),
    ),
  )

  .get("/api/health/processor", "probeProcessorHealth")
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, response, signal }, headers) =>
    response.pass(
      projectKeyedProbeResponseOf(
        await app.probeWithProjectKey({ check: "processor", headers, signal }),
      ),
    ),
  )

  .get("/api/health/triggers", "probeTriggersHealth")
  .withQuery(platformHealthQuerySchema)
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, input, response, signal }, headers) =>
    response.pass(
      projectKeyedProbeResponseOf(
        await app.probeWithProjectKey({
          check: "triggers",
          headers,
          triggerId: input.triggerId,
          signal,
        }),
      ),
    ),
  )

  .get("/api/health/workflows", "probeWorkflowsHealth")
  .withQuery(platformHealthQuerySchema)
  .withAccess(canary)
  .withHeaders(healthProbeHeadersSchema)
  .withResponse("forwarded", FORWARDED)
  .withDocs({ hide: true })
  .handle(async ({ app, input, response, signal }, headers) =>
    response.pass(
      projectKeyedProbeResponseOf(
        await app.probeWithProjectKey({
          check: "workflows",
          headers,
          workflowId: input.workflowId,
          signal,
        }),
      ),
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
      projectKeyedProbeResponseOf(
        await app.probeWithProjectKey({ check: "scenarios", headers, runPlanId: input.runPlanId }),
      ),
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
    response.pass(langyProbeResponseOf(await app.probeLangy({ actor, projectId: scope.id }))),
  )
  .build();
