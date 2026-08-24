import {
  ScenarioNotFoundError,
  ScenarioService as ScenarioServiceContract,
  scenarioCreateInputSchema,
  scenarioIdInputSchema,
  scenarioUpdateInputSchema,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioIdInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioUpdateInput,
} from "@langwatch/scenario-contract";
import type { ScenarioRepository } from "../repositories/scenario.repository";

export type ScenarioServiceOptions = {
  repository: ScenarioRepository;
  generateId: () => string;
  now?: () => Date;
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
      id: this.options.generateId(),
    });
  }

  async getById(input: ScenarioIdInput): Promise<Scenario> {
    const parsed = scenarioIdInputSchema.parse(input);
    const scenario = await this.options.repository.tryFindById(parsed);
    if (!scenario) throw new ScenarioNotFoundError(parsed.id);
    return scenario;
  }

  tryGetById(input: ScenarioIdInput): Promise<Scenario | null> {
    return this.options.repository.tryFindById(scenarioIdInputSchema.parse(input));
  }

  tryGetByIdIncludingArchived(input: ScenarioIdInput): Promise<Scenario | null> {
    return this.options.repository.tryFindByIdIncludingArchived(
      scenarioIdInputSchema.parse(input),
    );
  }

  list(input: { projectId: string }): Promise<Scenario[]> {
    return this.options.repository.findAll(
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
      archivedAt: (this.options.now ?? (() => new Date()))(),
    });
    if (!scenario) throw new ScenarioNotFoundError(parsed.id);
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
    const results = await Promise.allSettled(
      parsed.ids.map((id) => this.archive({ id, projectId: parsed.projectId })),
    );
    const archived: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const [index, result] of results.entries()) {
      const id = parsed.ids[index]!;
      if (result.status === "fulfilled") archived.push(id);
      else failed.push({ id, error: String(result.reason) });
    }
    return { archived, failed };
  }

  getRunConfigs(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]> {
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
}
