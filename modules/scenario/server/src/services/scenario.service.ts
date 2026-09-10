import {
  isCancellableStatus,
  ScenarioNotFoundError,
  scenarioCreateInputSchema,
  scenarioDuplicateInputSchema,
  scenarioTestSuiteCreateInputSchema,
  scenarioTestSuiteIdInputSchema,
  scenarioTestSuiteRenameInputSchema,
  scenarioTestSuiteUpdateInputSchema,
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
  type ScenarioTestSuite,
  type ScenarioTestSuiteCreateInput,
  type ScenarioTestSuiteIdInput,
  type ScenarioTestSuiteRenameInput,
  type ScenarioTestSuiteRunDefinition,
  type ScenarioTestSuiteUpdateInput,
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
import type { ScenarioRepository } from "../repositories/scenario.repository.ts";
import type { ScenarioClock } from "../app/scenario.app.ts";
import type { ScenarioTestSuiteId, ScenarioId } from "../app/scenario.app.ts";
import type { ScenarioSecretCipher } from "../app/scenario.app.ts";
import { ScenarioRunSecretsService } from "./scenario-run-secrets.service.ts";

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
  ids: ScenarioId;
  testSuiteIds: ScenarioTestSuiteId;
  clock: ScenarioClock;
  secretCipher: ScenarioSecretCipher;
};

/**
 * The scenario CRUD capability. Not implementing a contract abstract class: this was the
 * feature's contract-service (ADR-133 legacy shape), folded so the portable contract carries
 * only `ScenarioApi`; this class is now the sole, private definition of the shape.
 */
export class ScenarioService {
  static create(options: ScenarioServiceOptions): ScenarioService {
    return new ScenarioService(options);
  }

  private readonly runSecrets: ScenarioRunSecretsService;

  private constructor(private readonly options: ScenarioServiceOptions) {
    this.runSecrets = ScenarioRunSecretsService.create(options.secretCipher);
  }

  async create(input: ScenarioCreateInput): Promise<Scenario> {
    const parsed = scenarioCreateInputSchema.parse(input);
    // No scenario is loose: a create that names no suite files into the
    // project's Default, which is created here on the first such write.
    const testSuiteId =
      parsed.testSuiteId ?? (await this.ensureDefaultTestSuiteId(parsed.projectId));

    return this.options.repository.create({
      ...parsed,
      testSuiteId,
      id: this.options.ids.next(),
      actor: parsed.actor ?? actorFor(parsed.lastUpdatedById),
    });
  }

  /**
   * The id of the project's Default test suite, creating it if needed.
   * Resolved before the caller's transaction opens: the create can lose a
   * race, and Postgres aborts the transaction on that violation.
   */
  private async ensureDefaultTestSuiteId(projectId: string): Promise<string> {
    const existing = await this.options.repository.tryFindDefaultTestSuite({ projectId });
    if (existing) {return existing.id;}

    const created = await this.options.repository.createDefaultTestSuite({
      projectId,
      id: this.options.testSuiteIds.next(),
    });

    return created.id;
  }

  /**
   * Turns "no suite" into the project's Default suite. Clearing
   * `testSuiteId` asks to leave the current suite, not go loose; an
   * update naming no `testSuiteId` at all is left alone.
   */
  private async withResolvedTestSuite(parsed: ScenarioUpdateInput): Promise<ScenarioUpdateInput> {
    if (parsed.testSuiteId !== null) {return parsed;}

    return {
      ...parsed,
      testSuiteId: await this.ensureDefaultTestSuiteId(parsed.projectId),
    };
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

  async update(input: ScenarioUpdateInput): Promise<Scenario> {
    const parsed = await this.withResolvedTestSuite(scenarioUpdateInputSchema.parse(input));

    return this.options.repository.update({
      ...parsed,
      actor: parsed.actor ?? actorFor(parsed.lastUpdatedById),
    });
  }

  moveToTestSuite(input: ScenarioMoveInput): Promise<Scenario> {
    const parsed = scenarioMoveInputSchema.parse(input);

    return this.update({
      id: parsed.scenarioId,
      projectId: parsed.projectId,
      testSuiteId: parsed.testSuiteId,
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
      testSuiteId: original.testSuiteId,
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

  createTestSuite(input: ScenarioTestSuiteCreateInput): Promise<ScenarioTestSuite> {
    const parsed = scenarioTestSuiteCreateInputSchema.parse(input);

    return this.options.repository.createTestSuite({
      ...parsed,
      id: this.options.testSuiteIds.next(),
    });
  }

  findTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null> {
    return this.options.repository.tryFindTestSuite(scenarioTestSuiteIdInputSchema.parse(input));
  }

  listTestSuites(input: {
    projectId: string;
    includeArchived?: boolean;
  }): Promise<ScenarioTestSuite[]> {
    const { projectId } = scenarioIdInputSchema
      .pick({ projectId: true })
      .parse({ projectId: input.projectId });

    return this.options.repository.findTestSuites({
      projectId,
      includeArchived: input.includeArchived,
    });
  }

  async renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite> {
    const parsed = scenarioTestSuiteRenameInputSchema.parse(input);

    return this.options.repository.renameTestSuite(parsed);
  }

  updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite> {
    return this.options.repository.updateTestSuite(scenarioTestSuiteUpdateInputSchema.parse(input));
  }

  getTestSuiteRunDefinition(
    input: ScenarioTestSuiteIdInput,
  ): Promise<ScenarioTestSuiteRunDefinition> {
    return this.options.repository.getTestSuiteRunDefinition(
      scenarioTestSuiteIdInputSchema.parse(input),
    );
  }

  async archiveTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite> {
    const parsed = scenarioTestSuiteIdInputSchema.parse(input);

    return this.options.repository.archiveTestSuite({
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

  getModelChoices(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; simulatorModel: string | null; judgeModel: string | null }[]> {
    return this.options.repository.findModelChoices(input);
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
   * Dispatches the cancel command for one run, with no status read of its own. `cancelJob` reads
   * and guards before calling this because it is the single-run door and nothing has filtered for
   * it.
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
