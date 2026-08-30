import {
  isCancellableStatus,
  ScenarioNotFoundError,
  ScenarioService as ScenarioServiceContract,
  scenarioCreateInputSchema,
  scenarioDuplicateInputSchema,
  scenarioFolderCreateInputSchema,
  scenarioFolderIdInputSchema,
  scenarioFolderRenameInputSchema,
  scenarioFolderUpdateInputSchema,
  scenarioIdInputSchema,
  scenarioMoveInputSchema,
  scenarioParameterDefinitionsSchema,
  runParameterValuesSchema,
  scenarioUpdateInputSchema,
  scenarioVersionInputSchema,
  scenarioVersionListInputSchema,
  scenarioVersionRestoreInputSchema,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioFolder,
  type ScenarioFolderCreateInput,
  type ScenarioFolderIdInput,
  type ScenarioFolderRenameInput,
  type ScenarioFolderRunDefinition,
  type ScenarioFolderUpdateInput,
  type ScenarioIdInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioUpdateInput,
  type ScenarioActor,
  type ScenarioDuplicateInput,
  type ScenarioMoveInput,
  type ScenarioVersionDetail,
  type ScenarioVersionInput,
  type ScenarioVersionListInput,
  type ScenarioVersionRestoreInput,
  type ScenarioVersionSummary,
  type ResolveScenarioRunParametersInput,
  type ResolvedScenarioRunParameters,
  type ResolvedScenarioRunParametersForScenario,
  type CancelScenarioBatchInput,
  type CancelScenarioRunInput,
} from "@langwatch/scenario-contract";
import { resolveRunParameters } from "@langwatch/scenario-contract";
import { createLogger } from "@langwatch/observability";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { ScenarioRepository } from "../repositories/scenario.repository";
import type { ScenarioClockPort } from "../ports/scenario-clock.port";
import type { ScenarioFolderIdPort, ScenarioIdPort } from "../ports/scenario-id.port";
import type { ScenarioSecretCipherPort } from "../ports/scenario-secret-cipher.port";
import { ScenarioRunSecretsService } from "./scenario-run-secrets.service";

const logger = createLogger("langwatch:scenarios");

const defaultVersionPageSize = 20;

function actorFor(lastUpdatedById: string | null | undefined): ScenarioActor {
  return lastUpdatedById
    ? { userId: lastUpdatedById, label: "user" }
    : { userId: null, label: "api" };
}

export type ScenarioServiceOptions = {
  repository: ScenarioRepository;
  simulations: SimulationService;
  ids: ScenarioIdPort;
  folderIds: ScenarioFolderIdPort;
  clock: ScenarioClockPort;
  secretCipher: ScenarioSecretCipherPort;
};

export class ScenarioService extends ScenarioServiceContract {
  static create(options: ScenarioServiceOptions): ScenarioService {
    return new ScenarioService(options);
  }

  private readonly runSecrets: ScenarioRunSecretsService;

  private constructor(private readonly options: ScenarioServiceOptions) {
    super();
    this.runSecrets = ScenarioRunSecretsService.create(options.secretCipher);
  }

  create(input: ScenarioCreateInput): Promise<Scenario> {
    const parsed = scenarioCreateInputSchema.parse(input);

    return this.options.repository.create({
      ...parsed,
      id: this.options.ids.next(),
      actor: parsed.actor ?? actorFor(parsed.lastUpdatedById),
    });
  }

  getById(input: ScenarioIdInput): Promise<Scenario> {
    return this.options.repository.findById(scenarioIdInputSchema.parse(input));
  }

  tryGetById(input: ScenarioIdInput): Promise<Scenario | null> {
    return this.options.repository.tryFindById(scenarioIdInputSchema.parse(input));
  }

  tryGetByIdIncludingArchived(input: ScenarioIdInput): Promise<Scenario | null> {
    return this.options.repository.tryFindByIdIncludingArchived(scenarioIdInputSchema.parse(input));
  }

  list(input: { projectId: string }): Promise<Scenario[]> {
    return this.options.repository.findAll(
      scenarioIdInputSchema.pick({ projectId: true }).parse(input),
    );
  }

  count(input: { projectId: string }): Promise<number> {
    return this.options.repository.count(
      scenarioIdInputSchema.pick({ projectId: true }).parse(input),
    );
  }

  update(input: ScenarioUpdateInput): Promise<Scenario> {
    const parsed = scenarioUpdateInputSchema.parse(input);

    return this.options.repository.update({
      ...parsed,
      actor: parsed.actor ?? actorFor(parsed.lastUpdatedById),
    });
  }

  moveToFolder(input: ScenarioMoveInput): Promise<Scenario> {
    const parsed = scenarioMoveInputSchema.parse(input);

    return this.update({
      id: parsed.scenarioId,
      projectId: parsed.projectId,
      folderId: parsed.folderId,
    });
  }

  async duplicate(input: ScenarioDuplicateInput): Promise<Scenario> {
    const parsed = scenarioDuplicateInputSchema.parse(input);
    const original = await this.getById({
      id: parsed.scenarioId,
      projectId: parsed.projectId,
    });

    return this.create({
      projectId: original.projectId,
      name: `${original.name} (copy)`,
      situation: original.situation,
      criteria: original.criteria,
      labels: original.labels,
      parameters: scenarioParameterDefinitionsSchema.nullable().parse(original.parameters),
      simulatorModel: original.simulatorModel,
      judgeModel: original.judgeModel,
      maxTurns: original.maxTurns,
      minTurns: original.minTurns,
      folderId: original.folderId,
      lastUpdatedById: parsed.lastUpdatedById ?? null,
    });
  }

  async listVersions(input: ScenarioVersionListInput): Promise<{
    versions: ScenarioVersionSummary[];
    nextCursor: number | null;
  }> {
    const parsed = scenarioVersionListInputSchema.parse(input);
    const scenario = await this.options.repository.findByIdIncludingArchived({
      id: parsed.scenarioId,
      projectId: parsed.projectId,
    });

    const take = parsed.limit ?? defaultVersionPageSize;
    const versions = await this.options.repository.findVersions({ ...parsed, take });
    const storedVersionCount = versions.length;
    const lastStoredVersion = versions[versions.length - 1];
    const reachedBottom = versions.length < take;
    const hasStoredFirstVersion = versions.some((version) => version.version === 1);
    const pageCoversFirstVersion = parsed.cursor === void 0 || parsed.cursor > 1;
    if (reachedBottom && !hasStoredFirstVersion && pageCoversFirstVersion) {
      versions.push({
        version: 1,
        authorId: null,
        authorLabel: null,
        changeDescription: "Created",
        changedFields: [],
        createdAt: scenario.createdAt,
        isSynthesized: true,
      });
    }

    return {
      versions,
      nextCursor:
        storedVersionCount === take && lastStoredVersion && lastStoredVersion.version > 1
          ? lastStoredVersion.version
          : null,
    };
  }

  async getVersion(input: ScenarioVersionInput): Promise<ScenarioVersionDetail> {
    const parsed = scenarioVersionInputSchema.parse(input);
    await this.options.repository.findByIdIncludingArchived({
      id: parsed.scenarioId,
      projectId: parsed.projectId,
    });

    return this.options.repository.findVersion(parsed);
  }

  restoreVersion(input: ScenarioVersionRestoreInput): Promise<Scenario> {
    return this.options.repository.restoreVersion(scenarioVersionRestoreInputSchema.parse(input));
  }

  async archive(input: ScenarioIdInput): Promise<Scenario> {
    const parsed = scenarioIdInputSchema.parse(input);
    const scenario = await this.options.repository.tryArchive({
      ...parsed,
      archivedAt: this.options.clock.now(),
    });
    if (!scenario) {
      throw new ScenarioNotFoundError(parsed.id);
    }

    return scenario;
  }

  async batchArchive(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ archived: string[]; failed: { id: string; error: string }[] }> {
    const parsed = scenarioIdInputSchema
      .pick({ projectId: true })
      .extend({ ids: scenarioIdInputSchema.shape.id.array().min(1) })
      .parse(input);
    const result = await this.options.repository.archiveMany({
      ids: parsed.ids,
      projectId: parsed.projectId,
      archivedAt: this.options.clock.now(),
    });
    const failed = result.missing.map((id) => ({
      id,
      error: "Not found",
    }));

    return { archived: result.archived, failed };
  }

  createFolder(input: ScenarioFolderCreateInput): Promise<ScenarioFolder> {
    const parsed = scenarioFolderCreateInputSchema.parse(input);

    return this.options.repository.createFolder({
      ...parsed,
      id: this.options.folderIds.next(),
    });
  }

  tryGetFolder(input: ScenarioFolderIdInput): Promise<ScenarioFolder | null> {
    return this.options.repository.tryFindFolder(scenarioFolderIdInputSchema.parse(input));
  }

  listFolders(input: { projectId: string }): Promise<ScenarioFolder[]> {
    return this.options.repository.findFolders(
      scenarioIdInputSchema.pick({ projectId: true }).parse(input),
    );
  }

  async renameFolder(input: ScenarioFolderRenameInput): Promise<ScenarioFolder> {
    const parsed = scenarioFolderRenameInputSchema.parse(input);

    return this.options.repository.renameFolder(parsed);
  }

  updateFolder(input: ScenarioFolderUpdateInput): Promise<ScenarioFolder> {
    return this.options.repository.updateFolder(scenarioFolderUpdateInputSchema.parse(input));
  }

  getFolderRunDefinition(input: ScenarioFolderIdInput): Promise<ScenarioFolderRunDefinition> {
    return this.options.repository.getFolderRunDefinition(scenarioFolderIdInputSchema.parse(input));
  }

  async archiveFolder(input: ScenarioFolderIdInput): Promise<ScenarioFolder> {
    const parsed = scenarioFolderIdInputSchema.parse(input);

    return this.options.repository.archiveFolder({
      ...parsed,
      archivedAt: this.options.clock.now(),
    });
  }

  getRunConfigs(input: { ids: string[]; projectId: string }): Promise<ScenarioRunConfig[]> {
    return this.options.repository.findRunConfigs(input);
  }

  getReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]> {
    return this.options.repository.findReferenceStates(input);
  }

  getNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.options.repository.findNamesByIds(input);
  }

  async resolveRunParameters(
    input: ResolveScenarioRunParametersInput,
  ): Promise<ResolvedScenarioRunParameters> {
    const parsed = scenarioIdInputSchema.parse({
      id: input.scenarioId,
      projectId: input.projectId,
    });
    const values = runParameterValuesSchema.optional().parse(input.values);
    const configs = await this.options.repository.findRunConfigs({
      ids: [parsed.id],
      projectId: parsed.projectId,
    });
    const [config] = configs;
    if (!config) {
      throw new ScenarioNotFoundError(parsed.id);
    }

    const [forScenario] = await this.resolveRunParametersForScenarios({
      scenarios: [config],
      values,
    });
    if (!forScenario) {
      throw new ScenarioNotFoundError(parsed.id);
    }

    return {
      parameters: forScenario.parameters,
      secretParameters: forScenario.secretParameters,
      scenarioVersion: config.version,
    };
  }

  async resolveRunParametersForScenarios(input: {
    scenarios: ScenarioRunConfig[];
    values?: ResolveScenarioRunParametersInput["values"];
  }): Promise<ResolvedScenarioRunParametersForScenario[]> {
    const resolved = await resolveRunParameters(input);
    const versionsById = new Map(
      input.scenarios.map((scenario) => [scenario.id, scenario.version]),
    );

    return [...resolved].map(([scenarioId, values]) => {
      const scenarioVersion = versionsById.get(scenarioId);
      if (scenarioVersion === void 0) {
        throw new ScenarioNotFoundError(scenarioId);
      }

      return {
        scenarioId,
        parameters: values.parameters,
        secretParameters: this.runSecrets.encrypt(values.secretParameters),
        scenarioVersion,
      };
    });
  }

  async cancelJob(input: CancelScenarioRunInput): Promise<{ cancelled: boolean }> {
    logger.info(
      {
        projectId: input.projectId,
        scenarioRunId: input.scenarioRunId,
        batchRunId: input.batchRunId,
      },
      "Cancelling scenario job",
    );

    const batch = await this.options.simulations.getRunDataForBatchRun({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      batchRunId: input.batchRunId,
    });
    const runs = batch.changed ? batch.runs : [];
    const run = runs.find((candidate) => candidate.scenarioRunId === input.scenarioRunId);
    if (run && !isCancellableStatus(run.status)) {
      return { cancelled: false };
    }

    return this.requestCancellation(input.projectId, input.scenarioRunId);
  }

  /**
   * Dispatches the cancel command for one run, with no status read of its own.
   *
   * `cancelJob` reads and guards before calling this because it is the
   * single-run door and nothing has filtered for it. `cancelBatchRun` has
   * already filtered the same batch it read, so re-reading per run bought
   * nothing: `handleSimulationRunCancelRequested` only stamps
   * `CancellationRequestedAt` and never changes a run's status, so a cancel
   * that lands on a run which finished in the meantime is inert.
   */
  private async requestCancellation(
    projectId: string,
    scenarioRunId: string,
  ): Promise<{ cancelled: boolean }> {
    await this.options.simulations.cancelRun({
      tenantId: projectId,
      scenarioRunId,
      occurredAt: this.options.clock.now().getTime(),
    });

    return { cancelled: true };
  }

  async cancelBatchRun(input: CancelScenarioBatchInput): Promise<{
    cancelledCount: number;
    skippedCount: number;
  }> {
    const batch = await this.options.simulations.getRunDataForBatchRun({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      batchRunId: input.batchRunId,
    });
    const runs = batch.changed ? batch.runs : [];
    const cancellable = runs.filter((run) => isCancellableStatus(run.status));
    let cancelledCount = 0;

    for (let index = 0; index < cancellable.length; index += 10) {
      const chunk = cancellable.slice(index, index + 10);
      const results = await Promise.all(
        chunk.map((run) => this.requestCancellation(input.projectId, run.scenarioRunId)),
      );
      cancelledCount += results.filter((result) => result.cancelled).length;
    }

    return {
      cancelledCount,
      skippedCount: runs.length - cancellable.length,
    };
  }
}
