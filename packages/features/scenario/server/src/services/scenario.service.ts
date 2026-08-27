import {
  isCancellableStatus,
  ScenarioNotFoundError,
  ScenarioService as ScenarioServiceContract,
  scenarioCreateInputSchema,
  scenarioFolderCreateInputSchema,
  scenarioFolderIdInputSchema,
  scenarioFolderRenameInputSchema,
  scenarioFolderUpdateInputSchema,
  scenarioIdInputSchema,
  runParameterValuesSchema,
  scenarioUpdateInputSchema,
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
  type ResolveScenarioRunParametersInput,
  type ResolvedScenarioRunParameters,
  type ResolvedScenarioRunParametersForScenario,
  type CancelScenarioBatchInput,
  type CancelScenarioRunInput,
} from "@langwatch/scenario-contract";
import { resolveRunParameters } from "@langwatch/scenario-contract";
import { createLogger } from "@langwatch/observability";
import type { SimulationService } from "@langwatch/simulation-contract";
import type { ScenarioRepository } from "../repositories/scenario.repository";
import type { ScenarioClockPort } from "../ports/scenario-clock.port";
import type { ScenarioFolderIdPort, ScenarioIdPort } from "../ports/scenario-id.port";
import type { ScenarioSecretCipherPort } from "../ports/scenario-secret-cipher.port";

const logger = createLogger("langwatch:scenarios");

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

  private constructor(private readonly options: ScenarioServiceOptions) {
    super();
  }

  create(input: ScenarioCreateInput): Promise<Scenario> {
    const parsed = scenarioCreateInputSchema.parse(input);
    return this.options.repository.create({
      ...parsed,
      id: this.options.ids.next(),
    });
  }

  async getById(input: ScenarioIdInput): Promise<Scenario> {
    const parsed = scenarioIdInputSchema.parse(input);
    const scenario = await this.options.repository.tryFindById(parsed);
    if (!scenario) {
      throw new ScenarioNotFoundError(parsed.id);
    }
    return scenario;
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
    return this.options.repository.update(scenarioUpdateInputSchema.parse(input));
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
      error: String(new ScenarioNotFoundError(id)),
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
    if (configs.length === 0) {
      throw new ScenarioNotFoundError(parsed.id);
    }

    const [forScenario] = await this.resolveRunParametersForScenarios({
      scenarios: configs,
      values,
    });
    if (!forScenario) {
      throw new ScenarioNotFoundError(parsed.id);
    }

    return {
      parameters: forScenario.parameters,
      secretParameters: forScenario.secretParameters,
    };
  }

  async resolveRunParametersForScenarios(input: {
    scenarios: ScenarioRunConfig[];
    values?: ResolveScenarioRunParametersInput["values"];
  }): Promise<ResolvedScenarioRunParametersForScenario[]> {
    const resolved = await resolveRunParameters(input);

    return [...resolved].map(([scenarioId, values]) => ({
      scenarioId,
      parameters: values.parameters,
      secretParameters: this.encryptSecretParameters(values.secretParameters),
    }));
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

    await this.options.simulations.cancelRun({
      tenantId: input.projectId,
      scenarioRunId: input.scenarioRunId,
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
        chunk.map((run) =>
          this.cancelJob({
            projectId: input.projectId,
            scenarioSetId: input.scenarioSetId,
            batchRunId: run.batchRunId,
            scenarioRunId: run.scenarioRunId,
            scenarioId: run.scenarioId,
          }),
        ),
      );
      cancelledCount += results.filter((result) => result.cancelled).length;
    }

    return {
      cancelledCount,
      skippedCount: runs.length - cancellable.length,
    };
  }

  private encryptSecretParameters(
    values: Record<string, string>,
  ): ResolvedScenarioRunParameters["secretParameters"] {
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        this.options.secretCipher.encrypt(value),
      ]),
    );
  }
}
