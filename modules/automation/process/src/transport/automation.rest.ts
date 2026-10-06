/**
 * The `/api/triggers` family: the project's automations, over an API key.
 * Every rule about one is {@link AutomationApi}'s; this family owns its wire
 * shape: credentials as the placeholder, the rule apart from the delivery.
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
  automationRestFirePageSchema,
  automationRestFiresQuerySchema,
  automationRestIdParamsSchema,
  automationRestNoBodySchema,
  automationRestResponseSchema,
  automationRestStoredSlackTemplateTypeSchema,
  automationRestTestFireSchema,
  automationRestUpdateInputSchema,
  encodeTriggerFireCursor,
  findGraphAlertFromTriggerRow,
  findReportFromTriggerRow,
  graphAlertActionParamsSchema,
  reportActionParamsSchema,
  type AutomationRestFirePage,
  type AutomationRestResponse,
  type Trigger,
  type TriggerFirePage,
} from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import {
  replaceCredentialsWithPlaceholder,
  splitStoredRuleFromDelivery,
} from "../rules/trigger-redaction.rules.ts";

const logger = createLogger("langwatch:api:triggers");

/**
 * One automation on the wire. Every verb answers through here, so the
 * placeholder is applied once for the whole surface; the rule an automation
 * fires by is handed over apart from the delivery, as a save states it.
 */
function automationWire(params: {
  app: AutomationApi;
  projectSlug: string;
  trigger: Trigger;
}): AutomationRestResponse {
  const { trigger } = params;
  const { delivery } = splitStoredRuleFromDelivery(
    replaceCredentialsWithPlaceholder({ action: trigger.action, params: trigger.actionParams }),
  );
  const graphAlert = graphAlertActionParamsSchema.safeParse(
    findGraphAlertFromTriggerRow(trigger.actionParams),
  );
  const report = reportActionParamsSchema.safeParse(findReportFromTriggerRow(trigger.actionParams));

  return {
    id: trigger.id,
    name: trigger.name,
    action: trigger.action,
    actionParams: delivery,
    graphAlert: graphAlert.success ? graphAlert.data : null,
    report: report.success ? report.data : null,
    filters: trigger.filters,
    filterQuery: trigger.filterQuery,
    kind: trigger.triggerKind,
    customGraphId: trigger.customGraphId,
    notificationCadence: trigger.notificationCadence,
    traceDebounceMs: trigger.traceDebounceMs,
    templates: {
      slackTemplateType: automationRestStoredSlackTemplateTypeSchema.parse(
        trigger.templates.slackTemplateType,
      ),
      slackTemplate: trigger.templates.slackTemplate,
      emailSubjectTemplate: trigger.templates.emailSubjectTemplate,
      emailBodyTemplate: trigger.templates.emailBodyTemplate,
    },
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

/** One page of fires: metadata only, the cursor opaque. */
function firePageWire(page: TriggerFirePage): AutomationRestFirePage {
  return {
    fires: page.fires.map((fire) => ({
      id: fire.id,
      triggerId: fire.triggerId,
      customGraphId: fire.customGraphId,
      firedAt: fire.createdAt.toISOString(),
      resolvedAt: fire.resolvedAt ? fire.resolvedAt.toISOString() : null,
    })),
    nextCursor: page.nextCursor ? encodeTriggerFireCursor(page.nextCursor) : null,
  };
}

/** The `/api/triggers` endpoints; each also answers under `/api/v1/triggers`. */
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
        description:
          "List the project's automations, newest first. Paused automations are included.",
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, scope }, project) => {
        logger.info({ projectId: scope.id }, "Listing triggers");
        const triggers = await app.listAutomations({ projectId: scope.id });
        return triggers.map((trigger) =>
          automationWire({ app, projectSlug: project.projectSlug, trigger }),
        );
      })

      .get("/:triggerId", "getApiTriggersById")
      .withParams(automationRestIdParamsSchema)
      .withPermission("triggers:view")
      .responds({ 200: automationRestResponseSchema, 404: badRequestSchema })
      .withDocs({ tags: ["Triggers"], description: "Get a trigger by its ID" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, project) => {
        logger.info({ projectId: scope.id, triggerId: input.triggerId }, "Getting trigger");
        const trigger = await app.getPublicTrigger({
          triggerId: input.triggerId,
          projectId: scope.id,
        });
        return {
          status: 200 as const,
          body: automationWire({ app, projectSlug: project.projectSlug, trigger }),
        };
      })

      .get("/:triggerId/fires", "getApiTriggersByIdFires")
      .withParams(automationRestIdParamsSchema)
      .withQuery(automationRestFiresQuerySchema)
      .withPermission("triggers:view")
      .responds({ 200: automationRestFirePageSchema, 404: badRequestSchema })
      .withDocs({
        tags: ["Triggers"],
        description:
          "What this automation has done: its fires, newest first. Metadata only (no trace ids " +
          "and no trace content). Send `nextCursor` back as `cursor` to read the page after this one.",
      })
      .handle(async ({ app, input, scope }) => ({
        status: 200 as const,
        body: firePageWire(
          await app.getFireHistory({
            projectId: scope.id,
            triggerId: input.triggerId,
            limit: input.limit,
            cursor: input.cursor ?? null,
          }),
        ),
      }))

      // Creating asks for `triggers:create`; `:manage` still implies it, so no
      // existing caller changes and a viewer is declined as before.
      .post("/", "postApiTriggers")
      .withInput(automationRestCreateInputSchema)
      .withPermission("triggers:create")
      .withOutput(automationRestResponseSchema)
      .withStatus(201)
      .withDocs({
        tags: ["Triggers"],
        description:
          "Create an automation. Send `customGraphId` + `graphAlert` for an alert on a metric, " +
          "`report` for a scheduled report, or conditions for a trace automation. The delivery " +
          "channel is fixed at creation.",
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope, actor }, project) => {
        logger.info({ projectId: scope.id }, "Creating trigger");
        const trigger = await app.createPublicTrigger({
          projectId: scope.id,
          // The key's user, else the project's service actor (slack-trigger.rest.ts precedent).
          actorId: actor?.type === "user" ? actor.id : `svc_${scope.id}`,
          input,
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
        description:
          "Update an automation. Every field is optional and what is left out is left alone, " +
          "except `actionParams`, which replaces the delivery configuration as a whole. The " +
          "delivery channel and an alert's graph cannot be changed.",
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope, actor }, project) => {
        const { triggerId, ...body } = input;
        logger.info({ projectId: scope.id, triggerId }, "Updating trigger");
        const trigger = await app.updatePublicTrigger({
          projectId: scope.id,
          triggerId,
          // The key's user, else the project's service actor (slack-trigger.rest.ts precedent).
          actorId: actor?.type === "user" ? actor.id : `svc_${scope.id}`,
          input: body,
        });
        return {
          status: 200 as const,
          body: automationWire({ app, projectSlug: project.projectSlug, trigger }),
        };
      })

      // Both verbs answer with the automation, so a caller sees the state it is in.
      .post("/:triggerId/enable", "postApiTriggersByIdEnable")
      .withParams(automationRestIdParamsSchema)
      .withInput(automationRestNoBodySchema)
      .withPermission("triggers:update")
      .responds({ 200: automationRestResponseSchema, 404: badRequestSchema })
      .withDocs({
        tags: ["Triggers"],
        description:
          "Resume a paused automation. A report goes back on its schedule; the pause record is cleared.",
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, project) => ({
        status: 200 as const,
        body: automationWire({
          app,
          projectSlug: project.projectSlug,
          trigger: await app.setPublicTriggerActive({
            triggerId: input.triggerId,
            projectId: scope.id,
            active: true,
          }),
        }),
      }))

      .post("/:triggerId/disable", "postApiTriggersByIdDisable")
      .withParams(automationRestIdParamsSchema)
      .withInput(automationRestNoBodySchema)
      .withPermission("triggers:update")
      .responds({ 200: automationRestResponseSchema, 404: badRequestSchema })
      .withDocs({
        tags: ["Triggers"],
        description: "Pause an automation. A report stops claiming its schedule.",
      })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, project) => ({
        status: 200 as const,
        body: automationWire({
          app,
          projectSlug: project.projectSlug,
          trigger: await app.setPublicTriggerActive({
            triggerId: input.triggerId,
            projectId: scope.id,
            active: false,
          }),
        }),
      }))

      // The destination is the automation's own saved one: a test fire proves
      // a configured automation delivers; it is no way to send anywhere.
      .post("/:triggerId/test-fire", "postApiTriggersByIdTestFire")
      .withParams(automationRestIdParamsSchema)
      .withInput(automationRestNoBodySchema)
      .withPermission("triggers:update")
      .responds({ 200: automationRestTestFireSchema, 404: badRequestSchema })
      .withDocs({
        tags: ["Triggers"],
        description:
          "Send this automation's message to the destination it is configured with, so you can " +
          "confirm it arrives. Nothing is recorded as a fire.",
      })
      .handle(async ({ app, input, scope }) => {
        logger.info({ projectId: scope.id, triggerId: input.triggerId }, "Test-firing trigger");
        return {
          status: 200 as const,
          body: await app.testFireStoredTrigger({
            projectId: scope.id,
            triggerId: input.triggerId,
          }),
        };
      })

      // Destruction deliberately stays at `:manage`.
      .delete("/:triggerId", "deleteApiTriggersById")
      .withParams(automationRestIdParamsSchema)
      .withPermission("triggers:manage")
      .responds({ 200: automationRestDeletedSchema, 404: badRequestSchema })
      .withDocs({ tags: ["Triggers"], description: "Delete (soft-delete) a trigger" })
      .handle(async ({ app, input, scope }) => {
        logger.info({ projectId: scope.id, triggerId: input.triggerId }, "Deleting trigger");
        await app.deletePublicTrigger({ triggerId: input.triggerId, projectId: scope.id });
        return { status: 200 as const, body: { id: input.triggerId, deleted: true } };
      })
      .build()
  );
}
