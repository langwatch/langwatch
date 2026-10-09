/**
 * The insight module: what its doors call. Every operation asks the `release_insights` gate
 * first, then hands the work to the service.
 */

import type { EventingCommands } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  InsightApi,
  type FileInsightInput,
  type InsightEntry,
  type InsightApi as InsightApiContract,
} from "@langwatch/insight-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";

import {
  buildInsightPipeline,
  type InsightPipelineDefinition,
} from "../eventing/insight.pipeline.ts";
import type { InsightRepositories } from "../repositories/insight.repositories.ts";
import { InsightCommandsService } from "../services/insight-commands.service.ts";
import { InsightRolloutService } from "../services/insight-rollout.service.ts";
import { InsightService } from "../services/insight.service.ts";

type InsightSetup = FeatureSetup<
  typeof InsightModule.dependencies,
  never,
  undefined,
  InsightRepositories
>;

type ReaderScope = { projectId: string; insightId: string; userId: string };

export class InsightModule implements InsightApiContract {
  static readonly contract = InsightApi;
  static readonly dependencies = {
    featureFlags: FeatureFlagApi,
    projects: ProjectApi,
  };

  readonly #insights: InsightService;
  readonly #commands: InsightCommandsService;
  readonly #rollout: InsightRolloutService;
  readonly #pipeline: InsightPipelineDefinition;

  private constructor(parts: {
    insights: InsightService;
    commands: InsightCommandsService;
    rollout: InsightRolloutService;
    pipeline: InsightPipelineDefinition;
  }) {
    this.#insights = parts.insights;
    this.#commands = parts.commands;
    this.#rollout = parts.rollout;
    this.#pipeline = parts.pipeline;
  }

  static create(setup: InsightSetup): InsightModule {
    const { repositories, dependencies } = setup;
    const commands = InsightCommandsService.create();
    return new InsightModule({
      insights: InsightService.create({ insights: repositories.insights, commands }),
      commands,
      rollout: InsightRolloutService.create({
        featureFlags: dependencies.featureFlags,
        projects: dependencies.projects,
      }),
      pipeline: buildInsightPipeline({
        insightStore: repositories.insightProjection,
        readerStore: repositories.insightReaderProjection,
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
}
