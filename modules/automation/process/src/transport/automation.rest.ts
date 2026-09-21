/**
 * The `/api/triggers` family: the project's automations, over an API
 * key. Every rule about one is {@link AutomationApi}'s; this family owns
 * its wire shape, status codes, and its own 404.
 */
import {
  badRequestSchema,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
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
  app: AutomationApi;
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
    platformUrl: params.app.platformUrl({
      projectSlug: params.projectSlug,
      path: `/automations?drawer.open=automation&drawer.automationId=${trigger.id}`,
    }),
  };
}

/** The `/api/triggers` collection, item, create, edit and delete endpoints. */
export function createAutomationRest(): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AutomationApi>;
}> {
  return (
    defineRestRouter(AutomationApi)
      .withNamespace("triggers")
      .withVersion(MANAGEMENT_API_VERSION)

      .get("/", "getApiTriggers")
      .withPermission("triggers:view")
      .withOutput(z.array(automationRestResponseSchema))
      .withDocs({
        tags: ["Triggers"],
        description: "List all active triggers (automations) for the project",
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, scope }, project) => {
        logger.info({ projectId: scope.id }, "Listing triggers");

        const triggers = await app.getAllForProject({ projectId: scope.id });

        return triggers.map((trigger) =>
          automationWire({ app, projectSlug: project.projectSlug, trigger }),
        );
      })

      .get("/:triggerId", "getApiTriggersById")
      .withParams(automationRestIdParamsSchema)
      .withPermission("triggers:view")
      .responds({ 200: automationRestResponseSchema, 404: badRequestSchema })
      .withDocs({
        tags: ["Triggers"],
        description: "Get a trigger by its ID",
      })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, project) =>
        readAutomation({ app, id: input.triggerId, projectId: scope.id, project }),
      )

      // Creating asks for `triggers:create`; `:manage` still implies it, so no
      // existing caller changes and a viewer is declined as before.
      .post("/", "postApiTriggers")
      .withInput(automationRestCreateInputSchema)
      .withPermission("triggers:create")
      .withOutput(automationRestResponseSchema)
      .withStatus(201)
      .withDocs({
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

        return automationWire({ app, projectSlug: project.projectSlug, trigger });
      })

      .patch("/:triggerId", "patchApiTriggersById")
      .withParams(automationRestIdParamsSchema)
      .withInput(automationRestUpdateInputSchema)
      .withPermission("triggers:update")
      .responds({ 200: automationRestResponseSchema, 404: badRequestSchema })
      .withDocs({
        tags: ["Triggers"],
        description: "Update a trigger (name, active state, message, filters)",
      })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, project) =>
        editAutomation({ app, input, projectId: scope.id, project }),
      )

      // Destruction deliberately stays at `:manage`.
      .delete("/:triggerId", "deleteApiTriggersById")
      .withParams(automationRestIdParamsSchema)
      .withPermission("triggers:manage")
      .responds({ 200: automationRestDeletedSchema, 404: badRequestSchema })
      .withDocs({
        tags: ["Triggers"],
        description: "Delete (soft-delete) a trigger",
      })
      .handle(({ app, input, scope }) =>
        removeAutomation({ app, id: input.triggerId, projectId: scope.id }),
      )
      .build()
  );
}

/** The project facts a row is written with, as the mount resolves them. */
type ProjectFacts = Readonly<{ projectSlug: string }>;

/** One automation, or the sentence this family answers a miss with. */
async function readAutomation(args: {
  app: AutomationApi;
  id: string;
  projectId: string;
  project: ProjectFacts;
}): Promise<typeof NOT_FOUND | { status: 200; body: AutomationRestResponse }> {
  logger.info({ projectId: args.projectId, triggerId: args.id }, "Getting trigger");

  const trigger = await args.app.findLiveById({
    triggerId: args.id,
    projectId: args.projectId,
  });

  if (!trigger) return NOT_FOUND;

  return {
    status: 200 as const,
    body: automationWire({
      app: args.app,
      projectSlug: args.project.projectSlug,
      trigger,
    }),
  };
}

/**
 * The edit, with the two refusals it owns: delivery settings this door
 * can't safely forward, and a condition an edit would empty -- the other
 * route to a match-everything automation, which is the application's rule.
 */
async function editAutomation(args: {
  app: AutomationApi;
  input: { triggerId: string } & z.infer<typeof automationRestUpdateInputSchema>;
  projectId: string;
  project: ProjectFacts;
}): Promise<typeof NOT_FOUND | { status: 200; body: AutomationRestResponse }> {
  const { app, input, projectId } = args;

  if (input.actionParams !== undefined) {
    throw new InvalidActionParamsError(
      "Delivery settings are changed in the automation editor, not through this endpoint.",
      "actionParams",
    );
  }

  logger.info({ projectId, triggerId: input.triggerId }, "Updating trigger");

  const existing = await app.findLiveById({ triggerId: input.triggerId, projectId });

  if (!existing) return NOT_FOUND;

  app.assertConditionSurvivesEdit({ existing, filters: input.filters });

  return {
    status: 200 as const,
    body: automationWire({
      app,
      projectSlug: args.project.projectSlug,
      trigger: await app.update(updateCommandFor({ input, projectId })),
    }),
  };
}

/** Only the fields the body actually carried: an absent one changes nothing. */
function updateCommandFor(args: {
  input: { triggerId: string } & z.infer<typeof automationRestUpdateInputSchema>;
  projectId: string;
}): UpdateTriggerCommand {
  const { input, projectId } = args;
  const command: UpdateTriggerCommand = { id: input.triggerId, projectId };

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
async function removeAutomation(args: {
  app: AutomationApi;
  id: string;
  projectId: string;
}): Promise<typeof NOT_FOUND | { status: 200; body: { id: string; deleted: true } }> {
  logger.info({ projectId: args.projectId, triggerId: args.id }, "Deleting trigger");

  const existing = await args.app.findLiveById({
    triggerId: args.id,
    projectId: args.projectId,
  });

  if (!existing) return NOT_FOUND;

  await args.app.delete({ triggerId: args.id, projectId: args.projectId });

  return { status: 200 as const, body: { id: args.id, deleted: true } };
}
