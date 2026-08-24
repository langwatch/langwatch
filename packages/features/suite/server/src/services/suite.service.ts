import {
  createSuiteCommandSchema,
  suiteIdInputSchema,
  SuiteNameTakenError,
  SuiteNotFoundError,
  SuiteService as SuiteServiceContract,
  updateSuiteCommandSchema,
  type CreateSuiteCommand,
  type Suite,
  type SuiteIdInput,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";
import type { SuiteRepository } from "../repositories/suite.repository";

const archivedSlugSuffix = "__archived";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "suite";
}

export type SuiteServiceOptions = {
  repository: SuiteRepository;
  generateId?: () => string;
  now?: () => Date;
};

const defaultGenerateId = (): string => `suite_${crypto.randomUUID()}`;

export class SuiteService extends SuiteServiceContract {
  static create(options: SuiteServiceOptions): SuiteService {
    return new SuiteService(options);
  }

  private constructor(private readonly options: SuiteServiceOptions) {
    super();
  }

  list(input: { projectId: string }): Promise<Suite[]> {
    return this.options.repository.list(input);
  }

  async get(input: SuiteIdInput): Promise<Suite> {
    const parsed = suiteIdInputSchema.parse(input);
    const suite = await this.options.repository.tryFindById(parsed);
    if (!suite) throw new SuiteNotFoundError(parsed.id);
    return suite;
  }

  tryGet(input: SuiteIdInput): Promise<Suite | null> {
    return this.options.repository.tryFindById(suiteIdInputSchema.parse(input));
  }

  async create(input: CreateSuiteCommand): Promise<Suite> {
    const parsed = createSuiteCommandSchema.parse(input);
    const slug = slugify(parsed.name);
    await this.assertSlugAvailable({ projectId: parsed.projectId, slug });
    return this.options.repository.create({
      ...parsed,
      id: (this.options.generateId ?? defaultGenerateId)(),
      slug,
    });
  }

  async update(input: UpdateSuiteCommand): Promise<Suite> {
    const parsed = updateSuiteCommandSchema.parse(input);
    const slug = parsed.name === undefined ? undefined : slugify(parsed.name);
    if (slug !== undefined) {
      await this.assertSlugAvailable({ projectId: parsed.projectId, slug, excludeId: parsed.id });
    }
    return this.options.repository.update({ ...parsed, ...(slug === undefined ? {} : { slug }) });
  }

  async duplicate(input: SuiteIdInput): Promise<Suite> {
    const source = await this.get(input);
    const name = `${source.name} (copy)`;
    const slug = slugify(name);
    await this.assertSlugAvailable({ projectId: source.projectId, slug });
    return this.options.repository.create({
      projectId: source.projectId,
      name,
      description: source.description,
      scenarioIds: source.scenarioIds,
      targets: source.targets,
      repeatCount: source.repeatCount,
      labels: source.labels,
      simulatorModel: source.simulatorModel,
      judgeModel: source.judgeModel,
      id: (this.options.generateId ?? defaultGenerateId)(),
      slug,
    });
  }

  async archive(input: SuiteIdInput): Promise<Suite> {
    const suite = await this.get(input);
    const archivedSlug = suite.slug.endsWith(archivedSlugSuffix)
      ? suite.slug
      : `${suite.slug}${archivedSlugSuffix}-${suite.id.slice(-6)}`;
    return this.options.repository.archive({
      ...suiteIdInputSchema.parse(input),
      archivedAt: (this.options.now ?? (() => new Date()))(),
      archivedSlug,
    });
  }

  private async assertSlugAvailable(input: { projectId: string; slug: string; excludeId?: string }): Promise<void> {
    const existing = await this.options.repository.tryFindBySlug(input);
    if (existing && existing.id !== input.excludeId) throw new SuiteNameTakenError(existing.name);
  }
}
