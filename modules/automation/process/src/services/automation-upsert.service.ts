/** The authoring drawer's save: refuse a bad draft, persist its secrets, write its row. */
import {
  AutomationTraceFilterInvalidError,
  DEFAULT_TRACE_DEBOUNCE_MS,
  GraphAlertChannelUnsupportedError,
  GraphAlertSeverityRequiredError,
  GraphAlertThresholdRequiredError,
  hasActionableTriggerFilters,
  InvalidActionParamsError,
  MissingAnnotatorError,
  NotificationDeliveryError,
  NOTIFY_TRIGGER_ACTIONS,
  ReportChannelUnsupportedError,
  TriggerAction,
  TriggerFiltersRequiredError,
  type AutomationAction,
  type AutomationApiUpsertInput,
  type AutomationAuthor,
  type Trigger,
} from "@langwatch/automation-contract";
import { isDispatchError } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { generate as ksuid } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  AutomationProviderSecrets,
  AutomationTraceFilterCompiler,
} from "../app/automation.app.ts";
import {
  namesEmailRecipients,
  resolveCadenceForCreate,
  resolveCadenceForUpdate,
  validateEmailRecipientFormats,
} from "../rules/automation-authoring.rules.ts";
import {
  automationRowFor,
  TRIGGER_KSUID_RESOURCE,
  type AutomationRowDraft,
} from "../rules/automation-row.rules.ts";
import type { AutomationRulesService } from "./automation-rules.service.ts";
import type { AutomationSlackConnectionService } from "./automation-slack-connection.service.ts";
import type { AutomationService } from "./automation.service.ts";
import type { TriggerFilterValidationService } from "./trigger-filter-validation.service.ts";

/** What a save reaches. */
interface AutomationUpsertCollaborators {
  automation: AutomationService;
  rules: AutomationRulesService;
  providers: AutomationProviderSecrets;
  slackConnections: AutomationSlackConnectionService;
  traceFilters: AutomationTraceFilterCompiler;
  filterValidation: Pick<TriggerFilterValidationService, "assertWritable">;
}

const jsonObjectSchema = z.record(z.string(), z.unknown());

export class AutomationUpsertService {
  static create(collaborators: AutomationUpsertCollaborators): AutomationUpsertService {
    return new AutomationUpsertService(collaborators);
  }

  private constructor(private readonly collaborators: AutomationUpsertCollaborators) {}

  /**
   * The authoring drawer's save: one row of any of the three kinds, answered unredacted.
   * Graph alerts and reports use their own SSOT builders to stay byte-identical to the
   * dashboard path, since drift silently breaks whichever writer loses.
   */
  async save(args: {
    input: AutomationApiUpsertInput;
    author: AutomationAuthor;
  }): Promise<Trigger> {
    const { input, author } = args;
    const isGraphAlert = !!input.customGraphId;
    const isReport = !isGraphAlert && !!input.report;
    const parsedActionParams = await this.validateDraft({ input, isGraphAlert, isReport });
    const filterQuery = this.normalizeFilterQuery(input);

    // A trace automation must say which traces it is about. Checked after the
    // query is normalised, so a whitespace-only query counts as absent exactly
    // as it does everywhere else. Graph alerts and reports are exempt: an
    // alert's condition is its threshold and a report's is its schedule.
    const isTraceAutomation = !isGraphAlert && !isReport;
    const saysWhichTraces = filterQuery !== null || hasActionableTriggerFilters(input.filters);

    if (isTraceAutomation && !saysWhichTraces) throw new TriggerFiltersRequiredError();
    // Only a trace automation stores its structured conditions, when no query supersedes them.
    if (isTraceAutomation && filterQuery === null) {
      await this.collaborators.filterValidation.assertWritable({
        projectId: input.projectId,
        filters: input.filters,
      });
    }

    const actionParams = await this.persistedActionParams({ input, author, parsedActionParams });
    const data = automationRowFor({
      input,
      actionParams,
      filterQuery,
      isGraphAlert,
      isReport,
      id: input.triggerId ?? ksuid(TRIGGER_KSUID_RESOURCE).toString(),
    });
    const trigger = await this.writeRow({ input, data, isGraphAlert });

    if (isReport && input.report) {
      // Wire the report onto the calendar scheduler (ADR-044): its trigger id is
      // the scheduler targetId; the wake nudges every pod's loop.
      await this.collaborators.automation.syncReportSchedule({
        projectId: input.projectId,
        triggerId: trigger.id,
        cron: input.report.schedule.cron,
        timezone: input.report.schedule.timezone,
      });
    } else {
      // Editing a report into a trace automation or a graph alert must retire
      // its calendar entry, or the scheduled job keeps waking forever and the
      // handler reloads a row it can no longer parse. Idempotent.
      await this.collaborators.automation.removeReportSchedule({
        projectId: input.projectId,
        triggerId: trigger.id,
      });
    }

    await this.collaborators.automation.invalidate(input.projectId);

    return trigger;
  }

  /** The draft's params as the provider persists them, stamped with a queue's creator. */
  private async persistedActionParams({
    input,
    author,
    parsedActionParams,
  }: {
    input: AutomationApiUpsertInput;
    author: AutomationAuthor;
    parsedActionParams: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    // Provider persist hooks (ADR-041 / ADR-040 §3): encrypt the secrets and
    // resolve the "keep what is there" sentinels against the saved row.
    const loadExisting = async () =>
      input.triggerId
        ? (
            await this.collaborators.automation.findById({
              triggerId: input.triggerId,
              projectId: input.projectId,
            })
          )?.actionParams
        : undefined;
    const storedActionParams = await this.collaborators.providers.persistActionParamsFor(
      input.action,
      {
        incoming: await this.connectSlackParams({
          action: input.action,
          projectId: input.projectId,
          actorId: author.id,
          actionParams: parsedActionParams,
        }),
        loadExisting,
      },
    );

    // Annotation-queue dispatch attributes queue items to a user and skips the
    // action when `createdByUserId` is absent. The drawer's provider slice does
    // not carry it, so it is stamped from the caller here - an edit would
    // otherwise strip it and disable dispatch for the automation.
    return input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE
      ? { ...(storedActionParams as Record<string, unknown>), createdByUserId: author.id }
      : { ...(storedActionParams as Record<string, unknown>) };
  }

  /** Everything a save is refused for before a single secret is encrypted. */
  private async validateDraft(args: {
    input: AutomationApiUpsertInput;
    isGraphAlert: boolean;
    isReport: boolean;
  }): Promise<Record<string, unknown>> {
    const { input, isGraphAlert, isReport } = args;

    try {
      this.collaborators.automation.validateTemplateDraft(input.templates);

      if (isGraphAlert) {
        await assertGraphAlertDraft({ input, rules: this.collaborators.rules });
      }

      // A report sends a rendered notification on a schedule - notify channels
      // only, like alerts.
      if (
        isReport &&
        input.action !== TriggerAction.SEND_EMAIL &&
        input.action !== TriggerAction.SEND_SLACK_MESSAGE
      ) {
        throw new ReportChannelUnsupportedError();
      }

      // The provider registry's per-action schema is the authoritative shape.
      // The contract's own schema accepts the union for the wire format; this
      // pass narrows by action, so a SEND_EMAIL save cannot store a dataset
      // configuration and ADD_TO_DATASET cannot persist an empty datasetId.
      const perAction = this.collaborators.providers.actionParamsSchemaFor(input.action);
      // A Slack row not yet migrated, saved without its secret retyped, keeps the
      // stored one, which the connect step then moves into a connection.
      const parsed = perAction.safeParse(
        input.action === TriggerAction.SEND_SLACK_MESSAGE && input.triggerId
          ? this.collaborators.slackConnections.withKeptLegacySlackSecret({
              actionParams: jsonObjectSchema.parse(input.actionParams),
              stored: (
                await this.collaborators.automation.findById({
                  triggerId: input.triggerId,
                  projectId: input.projectId,
                })
              )?.actionParams,
            })
          : input.actionParams,
      );

      if (!parsed.success) {
        throw new InvalidActionParamsError(
          `Invalid actionParams for ${input.action}: ${parsed.error.issues[0]?.message ?? "validation failed"}`,
          input.action,
        );
      }

      if (namesEmailRecipients(input)) {
        validateEmailRecipientFormats(input.actionParams.members ?? []);
      }

      // Slack webhook and bot-channel presence are enforced by the per-action
      // schema above. The bot-token check, which must allow "kept" on edit,
      // runs in the provider's persist hook: it needs the saved row.
      const queueWithoutAnnotators =
        input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE &&
        (input.actionParams.annotators?.length ?? 0) === 0;

      if (queueWithoutAnnotators) throw new MissingAnnotatorError();

      // Persist the PARSED params, not the wire object: zod strips keys the
      // action does not declare, so a Slack secret typed before switching the
      // channel to email cannot ride along into the row in plaintext.
      return parsed.data as Record<string, unknown>;
    } catch (err) {
      this.raiseAsHandled(err);
    }
  }

  /**
   * ADR-043 Subject facet: blank collapses to null (legacy `filters` path);
   * non-empty is dry-run through the compiler so a malformed query is
   * refused with author feedback, not silently failed closed at dispatch.
   */
  private normalizeFilterQuery(input: AutomationApiUpsertInput): string | null {
    const filterQuery =
      input.filterQuery && input.filterQuery.trim() !== "" ? input.filterQuery.trim() : null;

    if (filterQuery === null) return null;

    try {
      this.collaborators.traceFilters.assertCompiles({
        query: filterQuery,
        projectId: input.projectId,
      });
    } catch (err) {
      throw new AutomationTraceFilterInvalidError(
        err instanceof Error ? err.message : "could not parse the query",
      );
    }

    return filterQuery;
  }

  /** The create, the update, and the one re-use a soft-deleted graph alert needs. */
  private async writeRow(args: {
    input: AutomationApiUpsertInput;
    data: AutomationRowDraft;
    isGraphAlert: boolean;
  }): Promise<Trigger> {
    const { input, data, isGraphAlert } = args;

    if (input.triggerId) {
      const cadence = resolveCadenceForUpdate(
        input.action,
        input.notificationCadence,
        isGraphAlert,
      );

      return this.collaborators.automation.update({
        id: input.triggerId,
        projectId: input.projectId,
        ...data,
        ...(cadence !== "unchanged" ? { notificationCadence: cadence.cadence } : {}),
        ...(input.traceDebounceMs !== undefined ? { traceDebounceMs: input.traceDebounceMs } : {}),
      });
    }

    // A graph alert owns its custom graph's unique `customGraphId` slot, and a
    // delete is a soft delete that keeps the row and the slot. A fresh create
    // for a graph that ever had an alert would violate the unique index, with
    // no path to recover since the soft-deleted row is hidden.
    const existingForGraph =
      isGraphAlert && input.customGraphId
        ? await this.collaborators.automation.findByCustomGraphId({
            projectId: input.projectId,
            customGraphId: input.customGraphId,
          })
        : null;

    if (existingForGraph) {
      return this.collaborators.automation.update({
        id: existingForGraph.id,
        projectId: input.projectId,
        ...data,
        deleted: false,
        active: true,
        lastRunAt: toDate(nowInstant()),
        notificationCadence: resolveCadenceForCreate(
          input.action,
          input.notificationCadence,
          isGraphAlert,
        ),
        traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
      });
    }

    return this.collaborators.automation.create({
      id: ksuid(TRIGGER_KSUID_RESOURCE).toString(),
      projectId: input.projectId,
      lastRunAt: toDate(nowInstant()),
      notificationCadence: resolveCadenceForCreate(
        input.action,
        input.notificationCadence,
        isGraphAlert,
      ),
      traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
      ...data,
    });
  }

  /** Main's `connectSlackParams`: a Slack save points at a connection before persist. */
  async connectSlackParams({
    action,
    projectId,
    actorId,
    actionParams,
    stored,
  }: {
    action: AutomationAction;
    projectId: string;
    actorId: string;
    actionParams: Record<string, unknown>;
    stored?: unknown;
  }): Promise<Record<string, unknown>> {
    if (action !== TriggerAction.SEND_SLACK_MESSAGE) return actionParams;
    return this.collaborators.slackConnections.connectActionParams({
      projectId,
      actorId,
      actionParams:
        stored === undefined
          ? actionParams
          : this.collaborators.slackConnections.withKeptLegacySlackSecret({ actionParams, stored }),
    });
  }

  /**
   * Re-raises a thrown value on the typed channel, and never returns. Anything
   * unhandled degrades to "unknown" plus a trace id at the boundary (ADR-045).
   */
  raiseAsHandled(err: unknown): never {
    if (HandledError.isHandled(err)) throw err;

    if (isDispatchError(err)) {
      throw new NotificationDeliveryError(err.message, { customerMessage: err.customerMessage });
    }

    throw err;
  }
}

/** A graph alert notifies only, and names its threshold, severity and a graph of its project. */
async function assertGraphAlertDraft({
  input,
  rules,
}: {
  input: AutomationApiUpsertInput;
  rules: AutomationRulesService;
}): Promise<void> {
  if (!NOTIFY_TRIGGER_ACTIONS.has(input.action)) throw new GraphAlertChannelUnsupportedError();
  if (!input.graphAlert) throw new GraphAlertThresholdRequiredError();
  if (!input.alertType) throw new GraphAlertSeverityRequiredError();

  await rules.assertCustomGraphInProject({
    customGraphId: input.customGraphId ?? "",
    projectId: input.projectId,
  });
}
