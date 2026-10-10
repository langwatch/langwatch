/**
 * The insight module: what its doors call. Every operation asks the `release_insights` gate
 * first, then hands the work to the service, which answers for the caller's own insights only.
 */

import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { DashboardApi } from "@langwatch/dashboard-contract";
import type { EventingCommands, ProcessStore } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  type ConfigureInsightDailyRunInput,
  InsightApi,
  type FileInsightInput,
  type InsightBoardDailyRunScope,
  type InsightDailyRun,
  type InsightDailyRunSetting,
  type InsightEntry,
  type InsightApi as InsightApiContract,
  type RequestInsightDailyRunInput,
  type TurnOffInsightDailyRunInput,
} from "@langwatch/insight-contract";
import { LangyApi } from "@langwatch/langy-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { UserApi } from "@langwatch/user-contract";

import {
  buildInsightDailyRunPipeline,
  type InsightDailyRunPipelineDefinition,
} from "../eventing/insight-daily-run.pipeline.ts";
import {
  buildInsightPipeline,
  type InsightPipelineDefinition,
} from "../eventing/insight.pipeline.ts";
import type { InsightRepositories } from "../repositories/insight.repositories.ts";
import { InsightCommandsService } from "../services/insight-commands.service.ts";
import { InsightDailyRunCommandsService } from "../services/insight-daily-run-commands.service.ts";
import { InsightDailyRunService } from "../services/insight-daily-run.service.ts";
import { InsightDailyScheduleReconcileService } from "../services/insight-daily-schedule-reconcile.service.ts";
import { InsightDailyScheduleService } from "../services/insight-daily-schedule.service.ts";
import { InsightRolloutService } from "../services/insight-rollout.service.ts";
import { InsightRunGateService } from "../services/insight-run-gate.service.ts";
import { InsightRunQueryService } from "../services/insight-run-query.service.ts";
import { InsightService } from "../services/insight.service.ts";

type InsightSetup = FeatureSetup<typeof InsightModule.dependencies, undefined, InsightRepositories>;

type Reader = { userId: string };
type ReaderScope = { projectId: string; insightId: string } & Reader;

export class InsightModule implements InsightApiContract {
  static readonly contract = InsightApi;
  static readonly dependencies = {
    featureFlags: FeatureFlagApi,
    projects: ProjectApi,
    /** What a daily run asks before it starts: the person, their access and the board. */
    users: UserApi,
    authz: AuthzApi,
    dashboards: DashboardApi,
    /** The turn a daily run reads the board with, as the person and read-only. */
    langy: LangyApi,
    /** Admits the query a finding keeps, before a reader ever replays it. */
    analytics: AnalyticsApi,
  };

  readonly #insights: InsightService;
  readonly #commands: InsightCommandsService;
  readonly #rollout: InsightRolloutService;
  readonly #pipeline: InsightPipelineDefinition;
  readonly #dailySchedules: InsightDailyScheduleService;
  readonly #scheduleReconcile: InsightDailyScheduleReconcileService;
  readonly #dailyRunCommands: InsightDailyRunCommandsService;
  readonly #dailyRunPipeline: InsightDailyRunPipelineDefinition;

  private constructor(parts: {
    insights: InsightService;
    commands: InsightCommandsService;
    rollout: InsightRolloutService;
    pipeline: InsightPipelineDefinition;
    dailySchedules: InsightDailyScheduleService;
    scheduleReconcile: InsightDailyScheduleReconcileService;
    dailyRunCommands: InsightDailyRunCommandsService;
    dailyRunPipeline: InsightDailyRunPipelineDefinition;
  }) {
    this.#insights = parts.insights;
    this.#commands = parts.commands;
    this.#rollout = parts.rollout;
    this.#pipeline = parts.pipeline;
    this.#dailySchedules = parts.dailySchedules;
    this.#scheduleReconcile = parts.scheduleReconcile;
    this.#dailyRunCommands = parts.dailyRunCommands;
    this.#dailyRunPipeline = parts.dailyRunPipeline;
  }

  static create(setup: InsightSetup): InsightModule {
    const { repositories, dependencies } = setup;
    const commands = InsightCommandsService.create();
    const dailyRunCommands = InsightDailyRunCommandsService.create();
    const rollout = InsightRolloutService.create({
      featureFlags: dependencies.featureFlags,
      projects: dependencies.projects,
    });
    const runs = InsightDailyRunService.create({
      gate: InsightRunGateService.create({
        rollout,
        projects: dependencies.projects,
        users: dependencies.users,
        authz: dependencies.authz,
        dashboards: dependencies.dashboards,
      }),
      langy: dependencies.langy,
      insights: repositories.insights,
      queries: InsightRunQueryService.create({ analytics: dependencies.analytics }),
      insightCommands: commands,
      runCommands: dailyRunCommands,
    });
    const scheduleReconcile = InsightDailyScheduleReconcileService.create({
      schedules: repositories.dailySchedules,
      commands: dailyRunCommands,
    });
    return new InsightModule({
      insights: InsightService.create({ insights: repositories.insights, commands }),
      commands,
      rollout,
      pipeline: buildInsightPipeline({
        insightStore: repositories.insightProjection,
        readerStore: repositories.insightReaderProjection,
      }),
      dailySchedules: InsightDailyScheduleService.create({
        schedules: repositories.dailySchedules,
        commands: dailyRunCommands,
        dashboards: dependencies.dashboards,
      }),
      scheduleReconcile,
      dailyRunCommands,
      dailyRunPipeline: buildInsightDailyRunPipeline({
        scheduleStore: repositories.dailyScheduleProjection,
        runs,
        reconcile: scheduleReconcile,
      }),
    });
  }

  /** The pipeline `insight_processing` registers, built once by {@link create}. */
  eventingPipeline(): InsightPipelineDefinition {
    return this.#pipeline;
  }

  /** Binds the registered pipeline's own senders; every insight write goes through them. */
  connectCommands(commands: EventingCommands<InsightPipelineDefinition>): void {
    this.#commands.connect(commands);
  }

  /**
   * The pipeline `insight_daily_run` registers, built once by {@link create}. The process that
   * hosts it lends its process store, which the reconcile pass reads each schedule's wake from.
   */
  dailyRunPipeline({
    processStore,
  }: {
    processStore: ProcessStore;
  }): InsightDailyRunPipelineDefinition {
    this.#scheduleReconcile.connect(processStore);
    return this.#dailyRunPipeline;
  }

  /** Binds the daily run pipeline's own senders; a run's request and outcome go through them. */
  connectDailyRunCommands(commands: EventingCommands<InsightDailyRunPipelineDefinition>): void {
    this.#dailyRunCommands.connect(commands);
  }

  async findInsights(input: { projectId: string; userId: string }): Promise<InsightEntry[]> {
    await this.#rollout.assertEnabled(input);
    return this.#insights.findForReader(input);
  }

  async fileInsight(input: FileInsightInput & { userId: string }): Promise<InsightEntry> {
    await this.#rollout.assertEnabled(input);
    return this.#insights.file(input);
  }

  async markInsightsSeen(input: {
    projectId: string;
    insightIds: readonly string[];
    userId: string;
  }): Promise<void> {
    await this.#rollout.assertEnabled(input);
    await this.#insights.markSeen(input);
  }

  async archiveInsight(input: ReaderScope): Promise<void> {
    await this.#rollout.assertEnabled(input);
    await this.#insights.archive(input);
  }

  async keepInsight(input: ReaderScope): Promise<void> {
    await this.#rollout.assertEnabled(input);
    await this.#insights.keep(input);
  }

  /** With the flag off no run is asked for; one already asked for is skipped when it starts. */
  async requestDailyRun(input: RequestInsightDailyRunInput): Promise<{ requestId: string }> {
    await this.#rollout.assertEnabled(input);
    return this.#dailySchedules.requestRun(input);
  }

  async findDailyRuns(input: { projectId: string; userId: string }): Promise<InsightDailyRun[]> {
    await this.#rollout.assertEnabled(input);
    return this.#dailySchedules.findForUser(input);
  }

  async getDailyRunSetting(
    input: InsightBoardDailyRunScope & Reader,
  ): Promise<InsightDailyRunSetting> {
    await this.#rollout.assertEnabled(input);
    return this.#dailySchedules.getSetting(input);
  }

  async configureDailyRun(input: ConfigureInsightDailyRunInput & Reader): Promise<void> {
    await this.#rollout.assertEnabled(input);
    await this.#dailySchedules.configure(input);
  }

  async turnOffDailyRun(input: TurnOffInsightDailyRunInput & Reader): Promise<void> {
    await this.#rollout.assertEnabled(input);
    await this.#dailySchedules.turnOff(input);
  }
}
