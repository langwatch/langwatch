/**
 * Everything the authoring surface does beyond reading a row back. The
 * caller arrives as an argument, never read from a session.
 * ADR-026, ADR-031, ADR-040, ADR-041, ADR-043, ADR-044.
 */
import {
  AutomationFiltersUnsupportedError,
  AutomationWebhookUpsertRequiredError,
  findReportFromTriggerRow,
  hasActionableTriggerFilters,
  InvalidActionParamsError,
  MissingAnnotatorError,
  MissingSlackWebhookError,
  ReportScheduleMissingError,
  TriggerAction,
  type UpdateTriggerCommand,
  type AutomationApiCreateInput,
  type AutomationApiListSlackChannelsInput,
  type AutomationApiTestFireInput,
  type AutomationApiToggleTriggerInput,
  type AutomationApiUpdateTriggerFiltersInput,
  type AutomationApiUpsertInput,
  type AutomationAction,
  type AutomationAuthor,
  type AutomationTestFireAuthor,
  type AutomationListRow,
  type AutomationPersistCapCount,
  type SlackChannelListing,
  type TestFireResult,
  type Trigger,
} from "@langwatch/automation-contract";
import { generate as ksuid } from "@langwatch/ksuid";
import type { Monitor, MonitorApi } from "@langwatch/monitor-contract";
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  AutomationCallCounter,
  AutomationProviderSecrets,
  AutomationSlackDirectory,
  AutomationTraceFilterCompiler,
} from "../app/automation.app.ts";
import type { AutomationSlackConnectionService } from "../features/slack/services/automation-slack-connection.service.ts";
import type { SlackDestinationService } from "../features/slack/services/slack-destination.service.ts";
import {
  extractCheckKeys,
  namesEmailRecipients,
  partitionFilterFields,
  resolveCadenceForCreate,
  validateEmailRecipientFormats,
} from "../rules/automation-authoring.rules.ts";
import { TRIGGER_KSUID_RESOURCE } from "../rules/automation-row.rules.ts";
import type { AutomationRulesService } from "./automation-rules.service.ts";
import { AutomationTestFireDestinationService } from "./automation-test-fire-destination.service.ts";
import { AutomationUpsertService } from "./automation-upsert.service.ts";
import type { AutomationLogger, AutomationService } from "./automation.service.ts";
import type { TriggerFilterValidationService } from "./trigger-filter-validation.service.ts";

/** What the authoring service reaches. */
interface AutomationAuthoringCollaborators {
  automation: AutomationService;
  rules: AutomationRulesService;
  monitors: MonitorApi;
  providers: AutomationProviderSecrets;
  slackChannels: AutomationSlackDirectory;
  /** Where a Slack test fire or channel listing posts, the way a real delivery resolves it. */
  slackDestinations: SlackDestinationService;
  /** Points a save's Slack params at a connection before the provider persists them. */
  slackConnections: AutomationSlackConnectionService;
  traceFilters: AutomationTraceFilterCompiler;
  limits: AutomationCallCounter;
  /** Refuses structured conditions that save fine and then match nothing. */
  filterValidation: Pick<TriggerFilterValidationService, "assertWritable">;
  logger: AutomationLogger;
}

const jsonObjectSchema = z.record(z.string(), z.unknown());

export class AutomationAuthoringService {
  static create(collaborators: AutomationAuthoringCollaborators): AutomationAuthoringService {
    return new AutomationAuthoringService(collaborators);
  }

  private readonly upserts: AutomationUpsertService;
  private readonly testFireDestinations: AutomationTestFireDestinationService;

  private constructor(private readonly collaborators: AutomationAuthoringCollaborators) {
    this.upserts = AutomationUpsertService.create(collaborators);
    this.testFireDestinations = AutomationTestFireDestinationService.create(collaborators);
  }

  /**
   * Strips secrets from a trigger row via the provider registry's redact
   * hook: the Slack bot token (ADR-041) and webhook headers (ADR-040 §3 --
   * names echo, values never return). Identity for every other action.
   */
  redactForRead<T extends { action: AutomationAction; actionParams: unknown }>(trigger: T): T {
    try {
      return {
        ...trigger,
        actionParams: this.collaborators.providers.redactActionParamsFor(
          trigger.action,
          trigger.actionParams ?? {},
        ),
      };
    } catch (error) {
      // A row saved under another credentials secret cannot be decrypted by
      // this one; it still lists, with its delivery configuration empty.
      this.collaborators.logger.warn(
        { error: error instanceof Error ? error.message : String(error), action: trigger.action },
        "trigger delivery configuration could not be read; returning it empty",
      );
      return { ...trigger, actionParams: {} };
    }
  }

  /** One automation as the browser reads it, or null when the project has none. */
  async findRedactedById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    const trigger = await this.collaborators.automation.findById(input);
    // A deleted automation reads as missing, as it does in the list.
    if (!trigger || trigger.deleted) return null;

    // Never return the encrypted bot token to the browser (ADR-041).
    return this.redactForRead(trigger);
  }

  /**
   * The automations list: every row, redacted, with the monitors its conditions
   * name and the custom graph a graph alert points at, so the page renders
   * "Graph: my-p95" without a second fetch per row.
   */
  async listRows(input: { projectId: string }): Promise<AutomationListRow[]> {
    const triggers = await this.collaborators.automation.getAllForProject(input);
    const allCheckIds = triggers.flatMap((trigger) => extractCheckKeys(trigger.filters));
    const allChecks = await this.collaborators.monitors.getAllByIds({
      monitorIds: allCheckIds,
      projectId: input.projectId,
    });
    const checksMap = allChecks.reduce<Record<string, Monitor>>((map, check) => {
      map[check.id] = check;

      return map;
    }, {});

    const customGraphIds = triggers
      .map((trigger) => trigger.customGraphId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const customGraphs =
      customGraphIds.length > 0
        ? await this.collaborators.automation.getCustomGraphNamesByIds({
            customGraphIds,
            projectId: input.projectId,
          })
        : [];
    const customGraphsById = new Map(customGraphs.map((graph) => [graph.id, graph]));

    return triggers.map((trigger) => ({
      ...this.redactForRead(trigger),
      checks: extractCheckKeys(trigger.filters)
        .map((id) => checksMap[id])
        .filter((check): check is Monitor => Boolean(check)),
      customGraph: trigger.customGraphId
        ? (customGraphsById.get(trigger.customGraphId) ?? null)
        : null,
    }));
  }

  /**
   * Today's ceiling and what each automation has spent of it, so the list can
   * say "N matches skipped today" rather than leaving the customer to wonder
   * why an automation they can see running produced nothing.
   */
  async readDailyCapStatus(input: {
    projectId: string;
  }): Promise<{ cap: number; counts: Record<string, AutomationPersistCapCount> }> {
    const cap = await this.collaborators.automation.resolvePersistDailyCap(input.projectId);
    const triggers = await this.collaborators.automation.getAllForProject(input);
    const counts = await this.collaborators.automation.readPersistCapCounts({
      projectId: input.projectId,
      triggerIds: triggers.map((trigger) => trigger.id),
      now: nowInstant(),
      cap,
    });

    return { cap, counts };
  }

  /** The Slack conversations a bot token can see, for the channel picker. */
  async listSlackChannels(
    input: AutomationApiListSlackChannelsInput,
  ): Promise<SlackChannelListing> {
    const [destination] = await this.collaborators.slackDestinations.findSlackDestination({
      projectId: input.projectId,
      actionParams: { slackIntegrationId: input.slackIntegrationId },
    });

    if (destination?.kind !== "bot") return { channels: [], error: "no_token", gaps: [] };

    return this.collaborators.slackChannels.list(destination.token);
  }

  /**
   * The legacy create path. It carries no graph or report shape, so it only
   * ever writes trace automations and the condition is always required.
   */
  async create(args: {
    input: AutomationApiCreateInput;
    author: AutomationAuthor;
  }): Promise<Trigger> {
    const { input, author } = args;

    // This mutation cannot carry the validated, encrypted webhook destination
    // shape. Never let a direct caller create a malformed or flag-bypassing
    // SEND_WEBHOOK row; the provider-aware upsert is the sole webhook writer.
    if (input.action === TriggerAction.SEND_WEBHOOK) {
      throw new AutomationWebhookUpsertRequiredError();
    }

    this.collaborators.rules.assertTraceConditionPresent(input.filters);
    await this.collaborators.filterValidation.assertWritable({
      projectId: input.projectId,
      filters: input.filters,
    });

    await this.collaborators.rules.getProjectIdentity(input.projectId);

    const actionParams: Record<string, unknown> = { ...input.actionParams };

    if (input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE) {
      // Server-stamp the creator: the schema does not expose it to the wire, so
      // a client cannot forge who a queue item is attributed to.
      actionParams.createdByUserId = author.id;

      if (!input.actionParams.annotators) throw new MissingAnnotatorError();
    }

    if (input.action === TriggerAction.SEND_SLACK_MESSAGE) {
      // A connection id or a legacy secret, stored as a connection id (ARCHITECTURE.md §3).
      if (!input.actionParams.slackIntegrationId && !input.actionParams.slackWebhook) {
        throw new MissingSlackWebhookError();
      }
      // Recipients are checked by RFC shape only, the same rule `save` applies:
      // external addresses are intentionally allowed and the UI badges them, so
      // create and edit cannot disagree about what an author may type.
    } else if (namesEmailRecipients(input)) {
      validateEmailRecipientFormats(input.actionParams.members ?? []);
    }

    const trigger = await this.collaborators.automation.create({
      id: ksuid(TRIGGER_KSUID_RESOURCE).toString(),
      name: input.name,
      action: input.action,
      actionParams,
      filters: input.filters,
      projectId: input.projectId,
      lastRunAt: toDate(nowInstant()),
      notificationCadence: resolveCadenceForCreate(input.action, input.notificationCadence),
      actorId: author.id,
    });

    return this.redactForRead(trigger);
  }

  /**
   * Pausing and resuming. A report's schedule does not live on `Trigger.active`
   * - it lives on the scheduler - so flipping the flag alone left the calendar
   * entry claiming its slot every cadence for a report that delivers nothing.
   */
  async setActive(input: AutomationApiToggleTriggerInput): Promise<Trigger> {
    const existing = await this.collaborators.rules.getById({
      triggerId: input.triggerId,
      projectId: input.projectId,
    });

    const isReport = existing.triggerKind === "REPORT";
    const report = isReport ? findReportFromTriggerRow(existing.actionParams) : null;

    if (isReport && input.active && !report) throw new ReportScheduleMissingError();

    const trigger = await this.collaborators.automation.update({
      id: input.triggerId,
      projectId: input.projectId,
      active: input.active,
      // Resuming clears the platform's pause record. Leaving it behind would
      // make a running automation keep claiming it was paused for runaway
      // volume, and the next genuine pause would be indistinguishable from it.
      ...(input.active ? { pausedReason: null, pausedAt: null } : {}),
    });

    if (isReport) {
      if (input.active && report) {
        await this.collaborators.automation.syncReportSchedule({
          projectId: input.projectId,
          triggerId: input.triggerId,
          cron: report.schedule.cron,
          timezone: report.schedule.timezone,
        });
      } else {
        await this.collaborators.automation.removeReportSchedule({
          projectId: input.projectId,
          triggerId: input.triggerId,
        });
      }
    }

    return this.redactForRead(trigger);
  }

  /**
   * A REST edit. Delivery settings replace the stored ones through the same
   * persist hook a save uses (secrets encrypted, kept sentinels resolved),
   * and the annotation queue's creator stays what is stored.
   */
  async update(command: UpdateTriggerCommand): Promise<Trigger> {
    const { actionParams } = command;
    const existing = actionParams
      ? await this.collaborators.automation.findById({
          triggerId: command.id,
          projectId: command.projectId,
        })
      : null;

    if (!actionParams || !existing) return this.collaborators.automation.update(command);

    const parsed = this.collaborators.providers
      .actionParamsSchemaFor(existing.action)
      .safeParse(actionParams);

    if (!parsed.success) {
      throw new InvalidActionParamsError(
        `Invalid actionParams for ${existing.action}: ${parsed.error.issues[0]?.message ?? "validation failed"}`,
        existing.action,
      );
    }

    const stored = await this.collaborators.providers.persistActionParamsFor(existing.action, {
      incoming: await this.upserts.connectSlackParams({
        action: existing.action,
        projectId: command.projectId,
        actorId: `svc_${command.projectId}`,
        actionParams: jsonObjectSchema.parse(parsed.data),
        stored: existing.actionParams,
      }),
      loadExisting: async () => existing.actionParams,
    });
    const creator = jsonObjectSchema.safeParse(existing.actionParams).data?.createdByUserId;
    const replaced = jsonObjectSchema.parse(stored);

    if (existing.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE) {
      delete replaced.createdByUserId;
      if (creator !== undefined) replaced.createdByUserId = creator;
    }

    const trigger = await this.collaborators.automation.update({
      ...command,
      actionParams: replaced,
    });

    return this.redactForRead(trigger);
  }

  /** Replaces one automation's condition, keeping it from matching everything. */
  async replaceFilters(input: AutomationApiUpdateTriggerFiltersInput): Promise<Trigger> {
    const { sanitized, unknownFields } = partitionFilterFields(input.filters);

    if (unknownFields.length > 0 && Object.keys(sanitized).length === 0) {
      throw new AutomationFiltersUnsupportedError(unknownFields);
    }

    if (!hasActionableTriggerFilters(sanitized)) {
      const existing = await this.collaborators.rules.getById({
        triggerId: input.triggerId,
        projectId: input.projectId,
      });

      this.collaborators.rules.assertConditionSurvivesEdit({ existing, filters: sanitized });
    }
    await this.collaborators.filterValidation.assertWritable({
      projectId: input.projectId,
      filters: sanitized,
    });

    const trigger = await this.collaborators.automation.update({
      id: input.triggerId,
      projectId: input.projectId,
      filters: sanitized,
    });

    return this.redactForRead(trigger);
  }

  /** Renders and delivers one test notification to the author themselves. */
  async testFire(args: {
    input: AutomationApiTestFireInput;
    author: AutomationTestFireAuthor;
  }): Promise<TestFireResult> {
    const { input, author } = args;

    try {
      const { recipients, botDestination, webhook, webhookDestination } =
        await this.testFireDestinations.resolve({ input, author });
      const project = await this.collaborators.rules.getProjectIdentity(input.projectId);

      return await this.collaborators.automation.testFire({
        channel: input.channel,
        trigger: input.trigger,
        project,
        draft: input.draft,
        recipients,
        webhook,
        botDestination,
        webhookDestination,
        graphAlert: input.graphAlert,
        report: input.report,
      });
    } catch (err) {
      this.upserts.raiseAsHandled(err);
    }
  }

  /**
   * The authoring drawer's save: one row, whichever of the three kinds. A
   * graph alert and report use their own SSOT builders to stay byte-identical
   * to the dashboard path, since drift silently breaks whichever writer loses.
   */
  async save(args: {
    input: AutomationApiUpsertInput;
    author: AutomationAuthor;
  }): Promise<Trigger> {
    return this.redactForRead(await this.upserts.save(args));
  }
}
