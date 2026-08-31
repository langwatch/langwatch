/**
 * The evaluations workbench: the customer's working copy of an experiment,
 * and its version history.
 *
 * Every write funnels through `saveWorkbenchState`. Restoring a version,
 * committing one, and recording a run's results all read the current state
 * and save it back, so there is exactly one place that checks references,
 * strips results out of the snapshot, publishes the update, and enforces
 * optimistic concurrency. A second write path would be a second chance to
 * forget one of those.
 *
 * The concurrency check is `expectedVersion`. Two people editing one
 * workbench is normal, so a save carrying a stale version is refused rather
 * than silently overwriting the other person's work — `StaleWorkbenchStateError`
 * is what the UI turns into "this changed while you were editing".
 *
 * Split out of `ExperimentService`, which was 749 lines and had this whole
 * sub-domain inside it alongside experiments, runs and DSPy steps.
 */

import {
  commitWorkbenchVersionInputSchema,
  createEvaluationsV3InputSchema,
  ExperimentNotFoundError,
  getWorkbenchStateInputSchema,
  InvalidExperimentConfigurationError,
  listWorkbenchVersionsInputSchema,
  parseWorkbenchState,
  recordWorkbenchRunResultsInputSchema,
  repairWorkbenchState,
  restoreWorkbenchVersionInputSchema,
  saveWorkbenchStateInputSchema,
  StaleWorkbenchStateError,
  stripWorkbenchResults,
  type CommitWorkbenchVersionInput,
  type CreateEvaluationsV3Input,
  type GetWorkbenchStateInput,
  type ListWorkbenchVersionsInput,
  type RecordWorkbenchRunResultsInput,
  type RestoreWorkbenchVersionInput,
  type SaveWorkbenchStateInput,
  type WorkbenchActor,
  type WorkbenchSaveResult,
  type WorkbenchStateView,
  type WorkbenchVersionsPage,
} from "@langwatch/experiment-contract";
import { PostgresUniqueConflict } from "../adapters/postgres.unique-conflict.adapter";
import type { ExperimentWorkbenchUpdatesPort } from "../ports/experiment-workbench-updates.port";
import type { ExperimentRepository } from "../repositories/experiment.repository";
import type { ExperimentSlugService } from "./experiment-slug.service";
import type { ExperimentWorkbenchReferencesService } from "./experiment-workbench-references.service";

/**
 * The one thing this needs from the experiment service that owns it: an
 * unused "Draft N" name for a workbench saved without one.
 */
export type ExperimentDraftNames = {
  findNextDraftName(input: { projectId: string }): Promise<string>;
};

export type ExperimentWorkbenchServiceOptions = {
  repository: ExperimentRepository;
  newId: () => string;
  updates: ExperimentWorkbenchUpdatesPort;
  slugs: ExperimentSlugService;
  references: ExperimentWorkbenchReferencesService;
  draftNames: ExperimentDraftNames;
};

export class ExperimentWorkbenchService {
  private readonly repository: ExperimentRepository;
  private readonly newId: () => string;
  private readonly updates: ExperimentWorkbenchUpdatesPort;
  private readonly slugs: ExperimentSlugService;
  private readonly references: ExperimentWorkbenchReferencesService;
  private readonly draftNames: ExperimentDraftNames;

  constructor(options: ExperimentWorkbenchServiceOptions) {
    this.repository = options.repository;
    this.newId = options.newId;
    this.updates = options.updates;
    this.slugs = options.slugs;
    this.references = options.references;
    this.draftNames = options.draftNames;
  }

  async getWorkbenchState(input: GetWorkbenchStateInput): Promise<WorkbenchStateView> {
    const query = getWorkbenchStateInputSchema.parse(input);
    const state = await this.repository.getWorkbenchState(query);

    return { ...state, state: repairWorkbenchState(state.state) };
  }

  async saveWorkbenchState(input: SaveWorkbenchStateInput): Promise<WorkbenchSaveResult> {
    const command = saveWorkbenchStateInputSchema.parse(input);
    const state = parseWorkbenchState(command.state);
    const target = await this.repository.resolveWorkbenchSaveTarget(command);
    if (target.kind === "create") {
      return await this.createEvaluationsV3({
        ...command,
        ...(target.id ? { id: target.id } : {}),
      });
    }
    const current = target.state;
    await this.references.assertAllExist({ projectId: command.projectId, state });

    const written = await this.repository.writeWorkbenchState({
      projectId: command.projectId,
      id: current.experimentId,
      name:
        state.name || (await this.draftNames.findNextDraftName({ projectId: command.projectId })),
      state,
      snapshot: stripWorkbenchResults(state),
      expectedVersion: command.expectedVersion,
      actor: command.actor,
      commitMessage: command.commitMessage,
    });
    if (written.kind === "stale") {
      throw new StaleWorkbenchStateError(written);
    }

    await this.publishUpdate({
      projectId: command.projectId,
      saved: written,
      actor: command.actor,
    });
    return written;
  }

  async createEvaluationsV3(input: CreateEvaluationsV3Input): Promise<WorkbenchSaveResult> {
    const command = createEvaluationsV3InputSchema.parse(input);
    const state = parseWorkbenchState(command.state);
    await this.references.assertAllExist({ projectId: command.projectId, state });
    const id = command.id ?? this.newId();
    const name =
      state.name ||
      command.name ||
      (await this.draftNames.findNextDraftName({ projectId: command.projectId }));
    const baseSlug = state.experimentSlug ?? id.slice(-8);
    const slug = await this.slugs.generateUnique({ baseSlug, projectId: command.projectId });
    const created = await this.createState({
      projectId: command.projectId,
      id,
      requestedId: command.id,
      slug,
      baseSlug,
      name,
      state,
      actor: command.actor,
      commitMessage: command.commitMessage,
    });
    const result = { experimentId: created.id, slug: created.slug, version: 1 };
    await this.publishUpdate({
      projectId: command.projectId,
      saved: result,
      actor: command.actor,
    });
    return result;
  }

  async commitWorkbenchVersion(input: CommitWorkbenchVersionInput): Promise<WorkbenchSaveResult> {
    const command = commitWorkbenchVersionInputSchema.parse(input);
    const current = await this.getWorkbenchState(command);
    if (!current.state) {
      throw new InvalidExperimentConfigurationError(current.slug);
    }

    return await this.saveWorkbenchState({
      ...command,
      state: current.state,
      expectedVersion: current.version,
    });
  }

  async listWorkbenchVersions(input: ListWorkbenchVersionsInput): Promise<WorkbenchVersionsPage> {
    const query = listWorkbenchVersionsInputSchema.parse(input);
    const current = await this.getWorkbenchState({ projectId: query.projectId, id: query.id });
    const take = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const versions = await this.repository.listWorkbenchVersions({
      projectId: query.projectId,
      experimentId: current.experimentId,
      take,
      ...(query.cursor === undefined ? {} : { beforeCounterVersion: query.cursor }),
    });
    const last = versions.at(-1);

    return { versions, nextCursor: versions.length === take && last ? last.counterVersion : null };
  }

  async restoreWorkbenchVersion(input: RestoreWorkbenchVersionInput): Promise<WorkbenchSaveResult> {
    const command = restoreWorkbenchVersionInputSchema.parse(input);
    const current = await this.getWorkbenchState(command);
    const version = await this.repository.getWorkbenchVersion({
      projectId: command.projectId,
      experimentId: current.experimentId,
      version: command.version,
    });
    const restored = parseWorkbenchState(version.state);

    return await this.saveWorkbenchState({
      projectId: command.projectId,
      id: current.experimentId,
      state: current.state?.results ? { ...restored, results: current.state.results } : restored,
      expectedVersion: current.version,
      actor: command.actor,
      commitMessage: version.autoSaved
        ? "Restored from the autosave"
        : `Restored from v${command.version}`,
    });
  }

  async recordWorkbenchRunResults(
    input: RecordWorkbenchRunResultsInput,
  ): Promise<WorkbenchSaveResult> {
    const command = recordWorkbenchRunResultsInputSchema.parse(input);
    const current = await this.getWorkbenchState({
      projectId: command.projectId,
      id: command.id,
    });
    if (!current.state) {
      throw new InvalidExperimentConfigurationError(current.slug);
    }

    return await this.saveWorkbenchState({
      projectId: command.projectId,
      id: current.experimentId,
      state: { ...current.state, results: command.results },
      expectedVersion: command.expectedVersion,
      actor: command.actor,
      commitMessage: command.commitMessage,
    });
  }

  private async createState(input: {
    projectId: string;
    id: string;
    requestedId?: string;
    slug: string;
    baseSlug: string;
    name: string;
    state: ReturnType<typeof parseWorkbenchState>;
    actor: CreateEvaluationsV3Input["actor"];
    commitMessage?: string;
  }): Promise<{ id: string; slug: string }> {
    try {
      return await this.repository.createWorkbenchState({
        projectId: input.projectId,
        id: input.id,
        slug: input.slug,
        name: input.name,
        state: input.state,
        snapshot: stripWorkbenchResults(input.state),
        actor: input.actor,
        commitMessage: input.commitMessage,
      });
    } catch (error) {
      if (!PostgresUniqueConflict.matches(error)) {
        throw error;
      }

      const retrySlug = await this.slugs.generateUnique({
        baseSlug: input.baseSlug,
        projectId: input.projectId,
      });
      try {
        return await this.repository.createWorkbenchState({
          projectId: input.projectId,
          id: input.id,
          slug: retrySlug,
          name: input.name,
          state: input.state,
          snapshot: stripWorkbenchResults(input.state),
          actor: input.actor,
          commitMessage: input.commitMessage,
        });
      } catch (retryError) {
        const targets = PostgresUniqueConflict.targets(retryError).map((target) =>
          target.toLowerCase(),
        );
        const slugConflict = targets.some((target) => target.includes("slug"));
        if (input.requestedId && PostgresUniqueConflict.matches(retryError) && !slugConflict) {
          const reasons = retryError instanceof Error ? [retryError] : [];

          throw new ExperimentNotFoundError(input.requestedId, { reasons });
        }

        throw retryError;
      }
    }
  }

  private async publishUpdate({
    projectId,
    saved,
    actor,
  }: {
    projectId: string;
    saved: WorkbenchSaveResult;
    actor: WorkbenchActor;
  }): Promise<void> {
    await this.updates.publish({
      projectId,
      experimentId: saved.experimentId,
      slug: saved.slug,
      version: saved.version,
      actorLabel: actor.label,
      ...(actor.runId ? { runId: actor.runId } : {}),
    });
  }
}
