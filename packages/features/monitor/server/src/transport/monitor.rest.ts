/**
 * The `/api/monitors` family: the online evaluations a project runs over its
 * live traffic.
 *
 * Every rule about a monitor is {@link MonitorApi}'s — what an unmentioned
 * field on a partial update means, and what a write does to one. This family
 * owns only its own wire shape and its status codes.
 */
import {
  badRequestSchema,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type PlatformUrlBuilder,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  MonitorApi,
  monitorRestCreateInputSchema,
  monitorRestDeletedSchema,
  monitorRestIdParamsSchema,
  monitorRestResponseSchema,
  monitorRestToggledSchema,
  monitorRestToggleInputSchema,
  monitorRestUpdateInputSchema,
  type Monitor,
  type MonitorRestResponse,
} from "@langwatch/monitor-contract";
import { z } from "zod";

const notFound = documentedResponses({ 404: badRequestSchema });

/** Where an online evaluation opens in the platform. */
function monitorWire(params: {
  platformUrl: PlatformUrlBuilder;
  projectSlug: string;
  monitor: Monitor;
}): MonitorRestResponse {
  const { monitor } = params;

  return {
    id: monitor.id,
    name: monitor.name,
    slug: monitor.slug,
    checkType: monitor.checkType,
    enabled: monitor.enabled,
    executionMode: monitor.executionMode,
    sample: monitor.sample,
    level: monitor.level,
    evaluatorId: monitor.evaluatorId,
    preconditions: monitor.preconditions,
    parameters: monitor.parameters,
    mappings: monitor.mappings,
    threadIdleTimeout: monitor.threadIdleTimeout,
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
    platformUrl: params.platformUrl({
      projectSlug: params.projectSlug,
      path: `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitor.id}`,
    }),
  };
}

/** The `/api/monitors` collection, item, toggle and delete endpoints. */
export function createMonitorsRest(
  platformUrl: PlatformUrlBuilder,
): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<MonitorApi>;
}> {
  return defineRestRouter(MonitorApi)
    .withNamespace("monitors")
    .withVersion(MANAGEMENT_API_VERSION)

    .get("/", "listMonitors")
    .withPermission("evaluations:view")
    .withOutput(z.array(monitorRestResponseSchema))
    .withDocs({
      tags: ["Monitors"],
      description: "List all online evaluation monitors for the project",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, scope }, project) =>
      (await app.list({ projectId: scope.id })).map((monitor) =>
        monitorWire({ platformUrl, projectSlug: project.projectSlug, monitor }),
      ),
    )

    .get("/:id", "getMonitor")
    .withParams(monitorRestIdParamsSchema)
    .withPermission("evaluations:view")
    .withOutput(monitorRestResponseSchema)
    .withDocs({
      tags: ["Monitors"],
      description: "Get a monitor by its ID",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) =>
      monitorWire({
        platformUrl,
        projectSlug: project.projectSlug,
        monitor: await app.getById({ id: input.id, projectId: scope.id }),
      }),
    )

    // `:create`, matching the tRPC twin the platform's own "create monitor"
    // button calls. `:manage` still satisfies this through the permission
    // hierarchy, so no existing caller loses access. Deletion stays on
    // `:manage` below, where the destructive line sits.
    .post("/", "createMonitor")
    .withInput(monitorRestCreateInputSchema)
    .withPermission("evaluations:create")
    .withOutput(monitorRestResponseSchema)
    .withStatus(201)
    .withDocs({
      tags: ["Monitors"],
      description: "Create a new online evaluation monitor",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) =>
      monitorWire({
        platformUrl,
        projectSlug: project.projectSlug,
        monitor: await app.create({
          projectId: scope.id,
          name: input.name,
          checkType: input.checkType,
          executionMode: input.executionMode,
          preconditions: input.preconditions,
          parameters: input.parameters,
          mappings: input.mappings,
          sample: input.sample,
          ...(input.evaluatorId === undefined ? {} : { evaluatorId: input.evaluatorId }),
          level: input.level,
          ...(input.threadIdleTimeout === undefined
            ? {}
            : { threadIdleTimeout: input.threadIdleTimeout }),
        }),
      }),
    )

    .patch("/:id", "updateMonitor")
    .withParams(monitorRestIdParamsSchema)
    .withInput(monitorRestUpdateInputSchema)
    .withPermission("evaluations:update")
    .withOutput(monitorRestResponseSchema)
    .withDocs({
      tags: ["Monitors"],
      description: "Update a monitor (name, enabled state, settings, etc.)",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) => {
      const { id, ...changes } = input;

      return monitorWire({
        platformUrl,
        projectSlug: project.projectSlug,
        monitor: await app.patch({ id, projectId: scope.id, changes }),
      });
    })

    // Enabling or disabling changes the monitor that already exists — an `:update`.
    .post("/:id/toggle", "toggleMonitor")
    .withParams(monitorRestIdParamsSchema)
    .withInput(monitorRestToggleInputSchema)
    .withPermission("evaluations:update")
    .withOutput(monitorRestToggledSchema)
    .withDocs({
      tags: ["Monitors"],
      description: "Enable or disable a monitor",
      responses: notFound,
    })
    .handle(async ({ app, input, scope }) => {
      await app.toggle({ id: input.id, projectId: scope.id, enabled: input.enabled });

      return { id: input.id, enabled: input.enabled };
    })

    // Destruction deliberately stays at `:manage`.
    .delete("/:id", "deleteMonitor")
    .withParams(monitorRestIdParamsSchema)
    .withPermission("evaluations:manage")
    .withOutput(monitorRestDeletedSchema)
    .withDocs({
      tags: ["Monitors"],
      description: "Delete a monitor",
      responses: notFound,
    })
    .handle(async ({ app, input, scope }) => {
      await app.delete({ id: input.id, projectId: scope.id });

      return { id: input.id, deleted: true };
    })
    .build();
}
