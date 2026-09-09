/**
 * The `/api/triggers` family: the project's automations, over an API key. Every
 * rule about one is {@link AutomationApi}'s; this family owns its wire shape and
 * its status codes, and answers its own 404 rather than leaving that body to a
 * process error handler.
 */
import {
  badRequestSchema,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type PlatformUrlBuilder,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  AutomationApi,
  automationRestCreateInputSchema,
  automationRestDeletedSchema,
  automationRestIdParamsSchema,
  automationRestResponseSchema,
  automationRestUpdateInputSchema,
  InvalidActionParamsError,
  type AutomationRestResponse,
  type Trigger,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { generate as ksuid } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:api:triggers");

/** The one sentence this family answers a miss with, unchanged since it shipped. */
const NOT_FOUND = { status: 404, body: { error: "Trigger not found" } } as const;

/** Where an automation opens in the platform. */
function automationWire(params: {
  platformUrl: PlatformUrlBuilder;
  projectSlug: string;
  trigger: Trigger;
}): AutomationRestResponse {
  const { trigger } = params;

  return {
    id: trigger.id,
    name: trigger.name,
    action: trigger.action as AutomationRestResponse["action"],
    actionParams: (trigger.actionParams ?? {}) as Record<string, unknown>,
    filters: trigger.filters,
    active: trigger.active,
    message: trigger.message,
    alertType: trigger.alertType,
    createdAt: trigger.createdAt.toISOString(),
    updatedAt: trigger.updatedAt.toISOString(),
    platformUrl: params.platformUrl({
      projectSlug: params.projectSlug,
      path: `/automations?drawer.open=automation&drawer.automationId=${trigger.id}`,
    }),
  };
}

/** The `/api/triggers` collection, item, create, edit and delete endpoints. */
export function createAutomationRest(platformUrl: PlatformUrlBuilder): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AutomationApi>;
}> {
  return defineRestRouter(AutomationApi)
    .withNamespace("triggers")
    .withVersion(MANAGEMENT_API_VERSION)

    .get("/", "listTriggers")
    .withPermission("triggers:view")
    .withOutput(z.array(automationRestResponseSchema))
    .withDocs({
      operationId: "listTriggers",
      tags: ["Triggers"],
      description: "List all active triggers (automations) for the project",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, scope }, project) => {
      logger.info({ projectId: scope.id }, "Listing triggers");

      const triggers = await app.getAllForProject({ projectId: scope.id });

      return triggers.map((trigger) =>
        automationWire({ platformUrl, projectSlug: project.projectSlug, trigger }),
      );
    })

    .get("/:id", "getTrigger")
    .withParams(automationRestIdParamsSchema)
    .withPermission("triggers:view")
    .responds({ 200: automationRestResponseSchema, 404: badRequestSchema })
    .withDocs({
      operationId: "getTrigger",
      tags: ["Triggers"],
      description: "Get a trigger by its ID",
    })
    .withMiddleware(projectRestFacts)
    .handle(({ app, input, scope }, project) =>
      readAutomation({ app, id: input.id, projectId: scope.id, project, platformUrl }),
    )

    // Creating asks for `triggers:create`; `:manage` still implies it, so no
    // existing caller changes and a viewer is declined as before.
    .post("/", "createTrigger")
    .withInput(automationRestCreateInputSchema)
    .withPermission("triggers:create")
    .withOutput(automationRestResponseSchema)
    .withStatus(201)
    .withDocs({
      operationId: "createTrigger",
      tags: ["Triggers"],
      description: "Create a new trigger (automation)",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) => {
      logger.info({ projectId: scope.id }, "Creating trigger");

      // This route only ever writes trace automations - it carries no graph or
      // report shape - so a condition is always required. The rule is the
      // application's, and the tRPC surface writes through the same operation.
      const trigger = await app.createTraceAutomation({
        id: ksuid("trigger").toString(),
        name: input.name,
        action: input.action,
        actionParams: input.actionParams,
        filters: input.filters ?? {},
        projectId: scope.id,
        message: input.message ?? null,
        alertType: input.alertType ?? null,
      });

      return automationWire({ platformUrl, projectSlug: project.projectSlug, trigger });
    })

    .patch("/:id", "updateTrigger")
    .withParams(automationRestIdParamsSchema)
    .withInput(automationRestUpdateInputSchema)
    .withPermission("triggers:update")
    .responds({ 200: automationRestResponseSchema, 404: badRequestSchema })
    .withDocs({
      operationId: "updateTrigger",
      tags: ["Triggers"],
      description: "Update a trigger (name, active state, message, filters)",
    })
    .withMiddleware(projectRestFacts)
    .handle(({ app, input, scope }, project) =>
      editAutomation({ app, input, projectId: scope.id, project, platformUrl }),
    )

    // Destruction deliberately stays at `:manage`.
    .delete("/:id", "deleteTrigger")
    .withParams(automationRestIdParamsSchema)
    .withPermission("triggers:manage")
    .responds({ 200: automationRestDeletedSchema, 404: badRequestSchema })
    .withDocs({
      operationId: "deleteTrigger",
      tags: ["Triggers"],
      description: "Delete (soft-delete) a trigger",
    })
    .handle(({ app, input, scope }) =>
      removeAutomation({ app, id: input.id, projectId: scope.id }),
    )
    .build();
}

/** The project facts a row is written with, as the mount resolves them. */
type ProjectFacts = Readonly<{ projectSlug: string }>;

/** One automation, or the sentence this family answers a miss with. */
async function readAutomation(args: {
  app: AutomationApi;
  id: string;
  projectId: string;
  project: ProjectFacts;
  platformUrl: PlatformUrlBuilder;
}) {
  logger.info({ projectId: args.projectId, triggerId: args.id }, "Getting trigger");

  const trigger = await args.app.tryGetLiveById({
    triggerId: args.id,
    projectId: args.projectId,
  });

  if (!trigger) return NOT_FOUND;

  return {
    status: 200 as const,
    body: automationWire({
      platformUrl: args.platformUrl,
      projectSlug: args.project.projectSlug,
      trigger,
    }),
  };
}

/**
 * The edit, with the two refusals it owns: delivery settings this door cannot
 * safely forward, and a condition an edit would empty. Editing is the other
 * route to a match-everything automation - create one with a real condition,
 * then patch the condition away - and that rule is the application's.
 */
async function editAutomation(args: {
  app: AutomationApi;
  input: { id: string } & z.infer<typeof automationRestUpdateInputSchema>;
  projectId: string;
  project: ProjectFacts;
  platformUrl: PlatformUrlBuilder;
}) {
  const { app, input, projectId } = args;

  if (input.actionParams !== undefined) {
    throw new InvalidActionParamsError(
      "Delivery settings are changed in the automation editor, not through this endpoint.",
      "actionParams",
    );
  }

  logger.info({ projectId, triggerId: input.id }, "Updating trigger");

  const existing = await app.tryGetLiveById({ triggerId: input.id, projectId });

  if (!existing) return NOT_FOUND;

  app.assertConditionSurvivesEdit({ existing, filters: input.filters });

  return {
    status: 200 as const,
    body: automationWire({
      platformUrl: args.platformUrl,
      projectSlug: args.project.projectSlug,
      trigger: await app.update(updateCommandFor({ input, projectId })),
    }),
  };
}

/** Only the fields the body actually carried: an absent one changes nothing. */
function updateCommandFor(args: {
  input: { id: string } & z.infer<typeof automationRestUpdateInputSchema>;
  projectId: string;
}): UpdateTriggerCommand {
  const { input, projectId } = args;
  const command: UpdateTriggerCommand = { id: input.id, projectId };

  if (input.name !== undefined) command.name = input.name;
  if (input.active !== undefined) command.active = input.active;
  if (input.message !== undefined) command.message = input.message;
  if (input.alertType !== undefined) command.alertType = input.alertType;
  if (input.filters !== undefined) command.filters = input.filters;

  return command;
}

/**
 * One operation, not two: the soft delete and the retirement of the report's
 * calendar entry belong together, and a door that did one without the other
 * left the scheduler waking forever.
 */
async function removeAutomation(args: { app: AutomationApi; id: string; projectId: string }) {
  logger.info({ projectId: args.projectId, triggerId: args.id }, "Deleting trigger");

  const existing = await args.app.tryGetLiveById({
    triggerId: args.id,
    projectId: args.projectId,
  });

  if (!existing) return NOT_FOUND;

  await args.app.delete({ triggerId: args.id, projectId: args.projectId });

  return { status: 200 as const, body: { id: args.id, deleted: true } };
}
