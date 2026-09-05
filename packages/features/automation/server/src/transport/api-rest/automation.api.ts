import {
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type PlatformUrlBuilder,
  promoteSchemaFailures,
  resolver,
} from "@langwatch/api/rest";
import {
  InvalidActionParamsError,
  type Trigger,
  TriggerNotFoundError,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { AutomationApp } from "#app/automation.app";

const logger = createLogger("langwatch:api:triggers");

const triggerActionEnum = z.enum([
  "SEND_EMAIL",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
  "SEND_SLACK_MESSAGE",
]);

const alertTypeEnum = z.enum(["CRITICAL", "WARNING", "INFO"]);

const triggerResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  action: triggerActionEnum,
  actionParams: z.record(z.string(), z.unknown()),
  filters: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  message: z.string().nullable(),
  alertType: alertTypeEnum.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const triggerResponseWithPlatformUrlSchema = triggerResponseSchema.extend({
  platformUrl: z.string().url(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const createTriggerSchema = z.object({
  name: z.string().min(1, "name is required"),
  action: triggerActionEnum,
  actionParams: z.record(z.string(), z.unknown()).default({}),
  // No default. An omitted condition used to become `{}`, which matches every
  // trace forever, so the easiest possible create call produced the most
  // expensive possible automation. Omitting it is now the same as sending an
  // empty one, and both are refused below with a typed 422.
  filters: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
  alertType: alertTypeEnum.optional(),
});

// Delivery settings are declared here only so an edit that carries them is
// REFUSED rather than silently dropped. They are not updatable through REST:
// the per-action shape check, the secret encryption and the unconditional
// `createdByUserId` stamp all live on the authoring surface, and a forwarded
// record would skip every one of them.
const updateTriggerSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  message: z.string().nullable().optional(),
  alertType: alertTypeEnum.nullable().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  actionParams: z.record(z.string(), z.unknown()).optional(),
});

function toTriggerResponse(trigger: Trigger) {
  return {
    id: trigger.id,
    name: trigger.name,
    action: trigger.action,
    actionParams: (trigger.actionParams ?? {}) as Record<string, unknown>,
    filters: trigger.filters,
    active: trigger.active,
    message: trigger.message,
    alertType: trigger.alertType,
    createdAt: trigger.createdAt.toISOString(),
    updatedAt: trigger.updatedAt.toISOString(),
  };
}

/**
 * REST for the project's automations, `/api/triggers`. The application arrives as a per-request
 * provider rather than being read off the Hono context, so this family can be mounted into any
 * process that has one and built with none by the OpenAPI generator.
 */
export function createTriggerRestApp(options: {
  security: AppRestSecurity;
  automation: () => AutomationApp;
  platformUrl: PlatformUrlBuilder;
}): MountableRestApp {
  const { security, automation, platformUrl } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "triggers",
    basePath: "/api/triggers",
    errorEnvelope: "legacy",
    // Two refusals this family names itself: the missing automation, whose
    // one-word body its callers already parse, and a request-schema failure,
    // which reaches the process's renderer as a bare zod-shaped error carrying
    // no status of its own.
    errorHandler: (boundary) =>
      promoteSchemaFailures((error, c) =>
        error instanceof TriggerNotFoundError
          ? c.json({ error: "Trigger not found" }, 404)
          : boundary(error, c),
      ),
  });

  const automationDrawerPath = (triggerId: string) =>
    `/automations?drawer.open=automation&drawer.automationId=${triggerId}`;

  const withPlatformUrl = (trigger: Trigger, project: { slug: string }) => ({
    ...toTriggerResponse(trigger),
    platformUrl: platformUrl({
      projectSlug: project.slug,
      path: automationDrawerPath(trigger.id),
    }),
  });

  /** The project's automation, or the refusal this family answers for a miss. */
  const liveTrigger = async (projectId: string, triggerId: string): Promise<Trigger> => {
    const trigger = await automation().tryGetLiveById({ triggerId, projectId });
    if (!trigger) throw new TriggerNotFoundError();
    return trigger;
  };

  const listHandler = async (c: Context) => {
    const project = c.get("project");
    logger.info({ projectId: project.id }, "Listing triggers");

    const triggers = await automation().getAllForProject({ projectId: project.id });
    return triggers.map((t) => withPlatformUrl(t, project));
  };

  const getHandler = async (c: Context, input: z.infer<typeof idParamsSchema>) => {
    const project = c.get("project");
    logger.info({ projectId: project.id, triggerId: input.id }, "Getting trigger");

    return withPlatformUrl(await liveTrigger(project.id, input.id), project);
  };

  const createHandler = async (c: Context, input: z.infer<typeof createTriggerSchema>) => {
    const project = c.get("project");
    logger.info({ projectId: project.id }, "Creating trigger");

    // This route only ever writes trace automations (it carries no graph or
    // report shape), so a condition is always required. The rule is the
    // application's, and `createTraceAutomation` is the operation that
    // carries it — the tRPC surface writes through the same one.
    const trigger = await automation().createTraceAutomation({
      id: nanoid(),
      name: input.name,
      action: input.action,
      actionParams: input.actionParams,
      filters: input.filters ?? {},
      projectId: project.id,
      message: input.message ?? null,
      alertType: input.alertType ?? null,
    });

    return withPlatformUrl(trigger, project);
  };

  const updateHandler = async (
    c: Context,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof updateTriggerSchema>,
  ) => {
    const project = c.get("project");
    if (input.actionParams !== undefined) {
      throw new InvalidActionParamsError(
        "Delivery settings are changed in the automation editor, not through this endpoint.",
        "actionParams",
      );
    }
    logger.info({ projectId: project.id, triggerId: input.id }, "Updating trigger");

    const app = automation();
    const trigger = await liveTrigger(project.id, input.id);

    // Editing is the other route to a match-everything automation: create one
    // with a real condition, then patch the condition away. The four-clause
    // rule is the application's; the tRPC surface applies the same one.
    app.assertConditionSurvivesEdit({ existing: trigger, filters: input.filters });

    const data: UpdateTriggerCommand = { id: input.id, projectId: project.id };
    if (input.name !== undefined) data.name = input.name;
    if (input.active !== undefined) data.active = input.active;
    if (input.message !== undefined) data.message = input.message;
    if (input.alertType !== undefined) data.alertType = input.alertType;
    if (input.filters !== undefined) data.filters = input.filters;

    return withPlatformUrl(await app.update({ ...data }), project);
  };

  const deleteHandler = async (c: Context, input: z.infer<typeof idParamsSchema>) => {
    const project = c.get("project");
    logger.info({ projectId: project.id, triggerId: input.id }, "Deleting trigger");

    const app = automation();
    await liveTrigger(project.id, input.id);

    // One operation, not two: the soft delete and the retirement of the
    // report's calendar entry belong together, and a door that did one without
    // the other left the scheduler waking forever.
    await app.delete({ triggerId: input.id, projectId: project.id });

    return { id: input.id, deleted: true };
  };

  const notFoundResponse = {
    404: {
      description: "Trigger not found",
      content: { "application/json": { schema: resolver(badRequestSchema) } },
    },
  };

  return (
    service
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy("triggers:view")(b)
          .withOutput(z.array(triggerResponseWithPlatformUrlSchema))
          .withDocs({
            operationId: "listTriggers",
            tags: ["Triggers"],
            description: "List all active triggers (automations) for the project",
            responses: { ...baseResponses },
          }),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy("triggers:view")(b)
          .withParams(idParamsSchema)
          .withOutput(triggerResponseWithPlatformUrlSchema)
          .withDocs({
            operationId: "getTrigger",
            tags: ["Triggers"],
            description: "Get a trigger by its ID",
            responses: { ...baseResponses, ...notFoundResponse },
          }),
      )
      // Creating asks for `triggers:create`; `:manage` still implies it, so no
      // existing caller changes and a viewer is declined as before.
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy("triggers:create")(b)
          .withInput(createTriggerSchema)
          .withOutput(triggerResponseWithPlatformUrlSchema)
          .withStatus(201)
          .withDocs({
            operationId: "createTrigger",
            tags: ["Triggers"],
            description: "Create a new trigger (automation)",
            responses: { ...baseResponses },
          }),
      )
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy("triggers:update")(b)
          .withParams(idParamsSchema)
          .withInput(updateTriggerSchema)
          .withOutput(triggerResponseWithPlatformUrlSchema)
          .withDocs({
            operationId: "updateTrigger",
            tags: ["Triggers"],
            description: "Update a trigger (name, active state, message, filters)",
            responses: { ...baseResponses, ...notFoundResponse },
          }),
      )
      // Destruction deliberately stays at `:manage`.
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, deleteHandler, (b) =>
        policy("triggers:manage")(b)
          .withParams(idParamsSchema)
          .withOutput(z.object({ id: z.string(), deleted: z.boolean() }))
          .withDocs({
            operationId: "deleteTrigger",
            tags: ["Triggers"],
            description: "Delete (soft-delete) a trigger",
            responses: { ...baseResponses, ...notFoundResponse },
          }),
      )
      .build()
  );
}
