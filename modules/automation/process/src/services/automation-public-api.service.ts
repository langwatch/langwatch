/**
 * What the public API may write, and on what terms: the same row the dashboard
 * writes, held to the same rules. The channel and the kind are fixed once an
 * automation exists. Main's `PublicApiTriggerService` (#6900); pure parts in `rules/`.
 */
import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  findReportFromTriggerRow,
  TriggerNotFoundError,
  type AutomationApiFireHistoryInput,
  type AutomationRestCreateInput,
  type AutomationRestUpdateInput,
  type TestFireResult,
  type Trigger,
  type TriggerFirePage,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { generate as ksuid } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  AutomationCallCounter,
  AutomationProviderSecrets,
  AutomationTraceFilterCompiler,
} from "../app/automation.app.ts";
import type { AutomationSlackConnectionService } from "../features/slack/services/automation-slack-connection.service.ts";
import type { SlackDestinationService } from "../features/slack/services/slack-destination.service.ts";
import type { TriggerFireHistoryRepository } from "../repositories/trigger-fire-history.repository.ts";
import {
  resolveCadenceForCreate,
  resolveCadenceForUpdate,
} from "../rules/automation-authoring.rules.ts";
import {
  assertWhatIsFixedIsUnchanged,
  templateColumns,
} from "../rules/automation-public-api.rules.ts";
import { AutomationRestColumnsService } from "./automation-rest-columns.service.ts";
import { AutomationRestTestFireService } from "./automation-rest-test-fire.service.ts";
import type { AutomationRulesService } from "./automation-rules.service.ts";
import type { AutomationLogger, AutomationService } from "./automation.service.ts";
import type { TriggerFilterValidationService } from "./trigger-filter-validation.service.ts";

const recordSchema = z.record(z.string(), z.unknown());

/** The rows and side effects a public-API write goes through. */
export type AutomationPublicApiRows = Pick<
  AutomationService,
  | "findById"
  | "softDeleteById"
  | "create"
  | "update"
  | "invalidate"
  | "syncReportSchedule"
  | "removeReportSchedule"
  | "validateTemplateDraft"
  | "testFire"
  | "customGraphExistsInProject"
>;

interface AutomationPublicApiCollaborators {
  automation: AutomationPublicApiRows;
  rules: Pick<AutomationRulesService, "getProjectIdentity">;
  providers: AutomationProviderSecrets;
  slackConnections: Pick<
    AutomationSlackConnectionService,
    "connectActionParams" | "withKeptLegacySlackSecret"
  >;
  slackDestinations: Pick<SlackDestinationService, "findSlackDestination">;
  filterValidation: Pick<TriggerFilterValidationService, "assertWritable">;
  history: Pick<TriggerFireHistoryRepository, "listPageByTriggerId">;
  traceFilters: AutomationTraceFilterCompiler;
  limits: AutomationCallCounter;
  logger: AutomationLogger;
}

export class AutomationPublicApiService {
  static create(collaborators: AutomationPublicApiCollaborators): AutomationPublicApiService {
    return new AutomationPublicApiService(collaborators);
  }

  private readonly columns: AutomationRestColumnsService;
  private readonly testFires: AutomationRestTestFireService;

  private constructor(private readonly deps: AutomationPublicApiCollaborators) {
    this.columns = AutomationRestColumnsService.create(deps);
    this.testFires = AutomationRestTestFireService.create(deps);
  }

  /** One live automation of the project, or `trigger_not_found`. */
  async getById({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<Trigger> {
    const trigger = await this.deps.automation.findById({ projectId, triggerId });
    if (!trigger || trigger.deleted) throw new TriggerNotFoundError();
    return trigger;
  }

  /** One live automation of the project as the API reads it, credentials redacted. */
  async getRedactedById(input: { projectId: string; triggerId: string }): Promise<Trigger> {
    return this.redactForRead(await this.getById(input));
  }

  /** Soft-deletes one live automation and retires its report schedule, or `trigger_not_found`. */
  async deleteById({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<void> {
    await this.getById({ projectId, triggerId });
    await this.deps.automation.softDeleteById({ projectId, triggerId });
    await this.deps.automation.removeReportSchedule({ projectId, triggerId });
  }

  async create({
    projectId,
    input,
    actorId,
  }: {
    projectId: string;
    input: AutomationRestCreateInput;
    /** Who a Slack connection made from a legacy secret is attributed to. */
    actorId: string;
  }): Promise<Trigger> {
    if (input.templates) this.deps.automation.validateTemplateDraft(input.templates);

    const isGraphAlert = !!input.customGraphId;
    const id = ksuid("trigger").toString();
    const columns = await this.columns.createColumns({ id, projectId, input, actorId });
    const trigger = await this.deps.automation.create({
      ...columns,
      id,
      projectId,
      actorId,
      message: input.message ?? null,
      notificationCadence: resolveCadenceForCreate(
        input.action,
        input.notificationCadence,
        isGraphAlert,
      ),
      traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
      lastRunAt: toDate(nowInstant()),
    });

    if (!isGraphAlert && input.report) {
      await this.deps.automation.syncReportSchedule({
        projectId,
        triggerId: trigger.id,
        cron: input.report.schedule.cron,
        timezone: input.report.schedule.timezone,
      });
    }
    await this.deps.automation.invalidate(projectId);
    return this.redactForRead(trigger);
  }

  async update({
    projectId,
    triggerId,
    input,
    actorId,
  }: {
    projectId: string;
    triggerId: string;
    input: AutomationRestUpdateInput;
    actorId: string;
  }): Promise<Trigger> {
    const stored = await this.getById({ projectId, triggerId });
    assertWhatIsFixedIsUnchanged({ stored, input });
    if (input.templates) this.deps.automation.validateTemplateDraft(input.templates);

    const command: UpdateTriggerCommand = {
      id: triggerId,
      projectId,
      ...templateColumns(input.templates),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      // Resuming clears the pause record, the same as enable does.
      ...(input.active === true ? { pausedReason: null, pausedAt: null } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.alertType !== undefined ? { alertType: input.alertType } : {}),
      ...(input.traceDebounceMs !== undefined ? { traceDebounceMs: input.traceDebounceMs } : {}),
      ...(await this.columns.conditionUpdate({ projectId, stored, input })),
      ...(await this.columns.actionParamsUpdate({ projectId, stored, input, actorId })),
    };
    // A pinned cadence is stated on every save, so the stored value cannot outlive what reads it.
    const cadence = resolveCadenceForUpdate(
      stored.action,
      input.notificationCadence,
      stored.customGraphId !== null,
    );
    if (cadence !== "unchanged") command.notificationCadence = cadence.cadence;

    const updated = await this.deps.automation.update(command);
    if (stored.triggerKind === "REPORT")
      await this.syncReportSchedule({ projectId, trigger: updated });
    await this.deps.automation.invalidate(projectId);
    return this.redactForRead(updated);
  }

  /**
   * Resume or pause. A report's schedule does not live on the row: pausing
   * retires its calendar entry, resuming puts it back (or retires it when the
   * report no longer parses), and resuming clears the pause record.
   */
  async setActive({
    projectId,
    triggerId,
    active,
  }: {
    projectId: string;
    triggerId: string;
    active: boolean;
  }): Promise<Trigger> {
    const stored = await this.getById({ projectId, triggerId });
    const updated = await this.deps.automation.update({
      id: triggerId,
      projectId,
      active,
      ...(active ? { pausedReason: null, pausedAt: null } : {}),
    });
    if (stored.triggerKind === "REPORT") {
      if (active) await this.syncReportSchedule({ projectId, trigger: updated });
      else await this.deps.automation.removeReportSchedule({ projectId, triggerId });
    }
    await this.deps.automation.invalidate(projectId);
    return this.redactForRead(updated);
  }

  /** One page of this automation's fires, newest first. Metadata only. */
  async getFireHistory(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage> {
    await this.getById(input);
    return this.deps.history.listPageByTriggerId(input);
  }

  /**
   * Send this automation's message to its saved destination, never one the
   * request supplies. The per-project cap bounds how often a key can make
   * LangWatch send (ADR-040 §4); nothing is recorded as a fire.
   */
  async testFire({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<TestFireResult> {
    return this.testFires.fire(await this.getById({ projectId, triggerId }));
  }

  /** The provider's own redaction; a row whose secrets cannot be read lists with none. */
  redactForRead(trigger: Trigger): Trigger {
    try {
      const params = this.deps.providers.redactActionParamsFor(
        trigger.action,
        trigger.actionParams,
      );
      return { ...trigger, actionParams: recordSchema.catch({}).parse(params) };
    } catch (error) {
      this.deps.logger.warn(
        { error: error instanceof Error ? error.message : String(error), action: trigger.action },
        "trigger delivery configuration could not be read; returning it empty",
      );
      return { ...trigger, actionParams: {} };
    }
  }

  private async syncReportSchedule({
    projectId,
    trigger,
  }: {
    projectId: string;
    trigger: Trigger;
  }): Promise<void> {
    const report = findReportFromTriggerRow(trigger.actionParams);
    if (!report || !trigger.active) {
      await this.deps.automation.removeReportSchedule({ projectId, triggerId: trigger.id });
      return;
    }
    await this.deps.automation.syncReportSchedule({
      projectId,
      triggerId: trigger.id,
      cron: report.schedule.cron,
      timezone: report.schedule.timezone,
    });
  }
}
