import {
  CLI_EPHEMERAL_LABEL,
  planNameKey,
  suiteSchema,
  SuiteNotFoundError,
  type CreateSuiteCommand,
  type RunPlanConfigInput,
  type Suite,
  type SuiteIdInput,
  type SuiteScope,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";
import { nowInstant, toDate } from "@langwatch/time";
import { SuiteRepository } from "../suite.repository.ts";
import { MemorySuiteDatabase } from "./memory.suite.database.ts";

/** What addresses the row rather than describing it, so an update never writes it. */
const ADDRESS_FIELDS = ["id", "projectId", "slug"];

/** A run plan of this project that is still listed. */
function isActivePlanOf(plan: Suite, projectId: string): boolean {
  return plan.projectId === projectId && plan.kind === "run_plan" && plan.archivedAt === null;
}

/** One more suffix than there are rows always leaves a free candidate. */
function nextAvailableSlug(baseSlug: string, taken: readonly string[]): string {
  if (!taken.includes(baseSlug)) return baseSlug;

  for (let suffix = 2; suffix <= taken.length + 2; suffix += 1) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }

  throw new Error(`No slug is free for "${baseSlug}"`);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "run-plan"
  );
}

/** The run plans, with the Postgres repository's own name, slug and scope rules. */
export class MemorySuiteRepository extends SuiteRepository {
  static create(input: { database?: MemorySuiteDatabase } = {}): MemorySuiteRepository {
    return new MemorySuiteRepository(input.database ?? MemorySuiteDatabase.create());
  }

  private constructor(private readonly database: MemorySuiteDatabase) {
    super();
  }

  async create(input: CreateSuiteCommand & { id: string; slug: string }): Promise<Suite> {
    const now = toDate(nowInstant());
    const plan = suiteSchema.parse({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      slug: input.slug,
      kind: "run_plan",
      description: input.description ?? null,
      scenarioIds: input.scenarioIds ?? [],
      scope: input.scope ?? null,
      targets: input.targets ?? [],
      repeatCount: input.repeatCount ?? 1,
      labels: input.labels ?? [],
      simulatorModel: input.simulatorModel ?? null,
      judgeModel: input.judgeModel ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.database.plans.set(plan.id, plan);

    return plan;
  }

  async list(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]> {
    return [...this.database.plans.values()]
      .filter(
        (plan) =>
          plan.projectId === input.projectId &&
          plan.kind === "run_plan" &&
          (input.includeArchived === true || plan.archivedAt === null),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async resolveDynamicRunMembership(input: SuiteIdInput): Promise<string[]> {
    const plan = this.database.plans.get(input.id);
    if (!plan || plan.projectId !== input.projectId || plan.archivedAt !== null) {
      throw new SuiteNotFoundError(input.id);
    }
    if (!plan.scope || plan.scope.mode === "scenarios") return plan.scenarioIds;

    const scenarioIds = await this.resolveScopeMembership({
      projectId: input.projectId,
      scope: plan.scope,
    });
    this.database.plans.set(plan.id, suiteSchema.parse({ ...plan, scenarioIds }));

    return scenarioIds;
  }

  async resolveScopeMembership(input: {
    projectId: string;
    scope: SuiteScope;
  }): Promise<string[]> {
    if (input.scope.mode === "scenarios") return [];

    const scenarios = this.database.activeScenarios(input.projectId);
    if (input.scope.mode === "all") return scenarios.map((scenario) => scenario.id);

    if (input.scope.mode === "test_suites") {
      const named = new Set(input.scope.testSuiteIds);

      return scenarios
        .filter((scenario) => scenario.testSuiteId !== null && named.has(scenario.testSuiteId))
        .map((scenario) => scenario.id);
    }

    const labels = new Set(input.scope.labels);

    return scenarios
      .filter((scenario) => scenario.labels.some((label) => labels.has(label)))
      .map((scenario) => scenario.id);
  }

  async findById(input: SuiteIdInput): Promise<Suite | null> {
    const plan = this.database.plans.get(input.id);
    const readable = plan !== undefined && isActivePlanOf(plan, input.projectId);

    return readable ? plan : null;
  }

  async findBySlug(input: { projectId: string; slug: string }): Promise<Suite | null> {
    return (
      [...this.database.plans.values()].find(
        (plan) => plan.slug === input.slug && isActivePlanOf(plan, input.projectId),
      ) ?? null
    );
  }

  async saveManagedRunAll(input: {
    id: string;
    projectId: string;
    name: string;
    baseSlug: string;
    label: string;
    scenarioIds: string[];
    targets?: Suite["targets"];
  }): Promise<Suite> {
    const existing = [...this.database.plans.values()]
      .filter((plan) => isActivePlanOf(plan, input.projectId) && plan.labels.includes(input.label))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];

    if (existing) {
      const updated = suiteSchema.parse({
        ...existing,
        scenarioIds: input.scenarioIds,
        ...(input.targets === undefined ? {} : { targets: input.targets }),
      });
      this.database.plans.set(updated.id, updated);

      return updated;
    }

    const slug = nextAvailableSlug(input.baseSlug, this.database.activeSlugs(input.projectId));

    return this.create({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      slug,
      scenarioIds: input.scenarioIds,
      targets: input.targets ?? [],
      labels: [input.label],
      repeatCount: 1,
    } as CreateSuiteCommand & { id: string; slug: string });
  }

  /**
   * The plan a NAME resolves to. A throwaway command-line row is skipped for
   * the reason the Postgres query skips it: joining one attaches this run to a
   * plan about to disappear from every list.
   */
  async findOrCreatePlanByName(input: {
    id: string;
    projectId: string;
    name: string;
    scope: SuiteScope;
    targets: Suite["targets"];
    scenarioIds: string[];
    config: RunPlanConfigInput;
  }): Promise<{ suite: Suite; created: boolean }> {
    const stored = {
      scope: input.scope,
      targets: input.targets,
      scenarioIds: input.scenarioIds,
      repeatCount: input.config.repeatCount ?? 1,
      simulatorModel: input.config.simulatorModel ?? null,
      judgeModel: input.config.judgeModel ?? null,
    };
    const now = toDate(nowInstant());

    const joinable = (plan: Suite): boolean =>
      isActivePlanOf(plan, input.projectId) &&
      planNameKey(plan.name) === planNameKey(input.name) &&
      !plan.labels.includes(CLI_EPHEMERAL_LABEL);

    const existing = [...this.database.plans.values()]
      .filter(joinable)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];

    if (existing) {
      const updated = suiteSchema.parse({ ...existing, ...stored, updatedAt: now });
      this.database.plans.set(updated.id, updated);

      return { suite: updated, created: false };
    }

    const created = suiteSchema.parse({
      id: input.id,
      projectId: input.projectId,
      name: input.name.trim(),
      slug: nextAvailableSlug(slugify(input.name), this.database.activeSlugs(input.projectId)),
      kind: "run_plan",
      description: null,
      labels: [],
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      ...stored,
    });
    this.database.plans.set(created.id, created);

    return { suite: created, created: true };
  }

  async update(input: UpdateSuiteCommand & { slug?: string }): Promise<Suite> {
    const existing = this.database.plans.get(input.id);
    if (!existing || !isActivePlanOf(existing, input.projectId)) {
      throw new SuiteNotFoundError(input.id);
    }

    const written = Object.entries(input).filter(
      ([field, value]) => value !== undefined && !ADDRESS_FIELDS.includes(field),
    );
    const updated = suiteSchema.parse({
      ...existing,
      ...Object.fromEntries(written),
      slug: input.slug ?? existing.slug,
      updatedAt: toDate(nowInstant()),
    });
    this.database.plans.set(updated.id, updated);

    return updated;
  }

  // The archive stamp is the interface's, which carries it at the Prisma
  // boundary's own type.
  async archive(input: Parameters<SuiteRepository["archive"]>[0]): Promise<Suite> {
    const existing = this.database.plans.get(input.id);
    const addressed = existing?.projectId === input.projectId && existing.kind === "run_plan";
    if (!existing || !addressed) throw new SuiteNotFoundError(input.id);

    const archived = suiteSchema.parse({
      ...existing,
      archivedAt: input.archivedAt,
      slug: input.archivedSlug,
      updatedAt: toDate(nowInstant()),
    });
    this.database.plans.set(archived.id, archived);

    return archived;
  }
}
