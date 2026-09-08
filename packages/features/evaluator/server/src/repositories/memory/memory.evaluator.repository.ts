import {
  evaluatorConfigSchema,
  evaluatorSchema,
  type Evaluator,
  type EvaluatorConfig,
  type EvaluatorCopy,
  type EvaluatorUpdateInput,
} from "@langwatch/evaluator-contract";
import { nowInstant, toDate } from "@langwatch/time";
import type { EvaluatorRepository, PersistEvaluatorInput } from "../evaluator.repository.ts";

const generateEvaluatorSlug = (name: string): string => {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "evaluator";
};

/**
 * The project path a copy is listed under. Postgres reads it through the
 * project's team and organization rows, which nothing in memory holds, so the
 * twin answers the id and the same shape of path.
 */
const memoryFullPath = (projectId: string): string => `memory / memory / ${projectId}`;

export class MemoryEvaluatorRepository implements EvaluatorRepository {
  #rows = new Map<string, Evaluator>();

  private constructor() {}

  static create(): MemoryEvaluatorRepository {
    return new MemoryEvaluatorRepository();
  }

  async findById(input: { id: string; projectId: string }): Promise<Evaluator | undefined> {
    return this.#clone(
      this.#live().find((row) => row.id === input.id && row.projectId === input.projectId),
    );
  }

  async findByIdAcrossProjects(id: string): Promise<Evaluator | undefined> {
    return this.#clone(this.#live().find((row) => row.id === id));
  }

  async findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined> {
    return this.#clone(
      this.#live().find((row) => row.slug === input.slug && row.projectId === input.projectId),
    );
  }

  async findByWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Evaluator | undefined> {
    return this.#clone(
      this.#live().find(
        (row) => row.workflowId === input.workflowId && row.projectId === input.projectId,
      ),
    );
  }

  async findByIdOrSlug(input: {
    idOrSlug: string;
    projectId: string;
  }): Promise<Evaluator | undefined> {
    return this.#clone(
      this.#live().find(
        (row) =>
          row.projectId === input.projectId &&
          (row.id === input.idOrSlug || row.slug === input.idOrSlug),
      ),
    );
  }

  async findAll(input: { projectId: string }): Promise<Evaluator[]> {
    return this.#live()
      .filter((row) => row.projectId === input.projectId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((row) => this.#withCopyCount(row));
  }

  async findCopies(input: { evaluatorId: string }): Promise<EvaluatorCopy[]> {
    return this.#live()
      .filter((row) => row.copiedFromEvaluatorId === input.evaluatorId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        projectId: row.projectId,
        fullPath: memoryFullPath(row.projectId),
      }));
  }

  async create(input: PersistEvaluatorInput): Promise<Evaluator> {
    const now = toDate(nowInstant());
    const row = evaluatorSchema.parse({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      slug: this.#freeSlug(input),
      type: input.type,
      config: evaluatorConfigSchema.parse(input.config),
      workflowId: input.workflowId ?? null,
      copiedFromEvaluatorId: input.copiedFromEvaluatorId ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    this.#rows.set(row.id, row);

    return structuredClone(row);
  }

  async update(input: EvaluatorUpdateInput): Promise<Evaluator> {
    const existing = this.#require(input);
    const updated = evaluatorSchema.parse({
      ...existing,
      ...(input.data.name !== void 0 ? { name: input.data.name } : {}),
      ...(input.data.type !== void 0 ? { type: input.data.type } : {}),
      ...(input.data.workflowId !== void 0 ? { workflowId: input.data.workflowId } : {}),
      ...(input.data.config !== void 0
        ? { config: evaluatorConfigSchema.parse(input.data.config) }
        : {}),
      updatedAt: toDate(nowInstant()),
    });

    this.#rows.set(updated.id, updated);

    return structuredClone(updated);
  }

  async archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    const existing = this.#require(input);
    const archived = evaluatorSchema.parse({
      ...existing,
      archivedAt: toDate(nowInstant()),
      updatedAt: toDate(nowInstant()),
    });

    this.#rows.set(archived.id, archived);

    return structuredClone(archived);
  }

  async updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: EvaluatorConfig;
  }): Promise<void> {
    const existing = this.#require(input);
    const updated = evaluatorSchema.parse({
      ...existing,
      name: input.name,
      config: evaluatorConfigSchema.parse(input.config),
      updatedAt: toDate(nowInstant()),
    });

    this.#rows.set(updated.id, updated);
  }

  /** Archived rows are invisible to every read, as the Postgres filters make them. */
  #live(): Evaluator[] {
    return [...this.#rows.values()].filter((row) => row.archivedAt === null);
  }

  #clone(row: Evaluator | undefined): Evaluator | undefined {
    return row ? structuredClone(row) : void 0;
  }

  #withCopyCount(row: Evaluator): Evaluator {
    const copiedEvaluators = this.#live().filter(
      (candidate) => candidate.copiedFromEvaluatorId === row.id,
    ).length;

    return structuredClone({ ...row, copyCount: copiedEvaluators, _count: { copiedEvaluators } });
  }

  /** Postgres retries a slug collision inside the project; so does the twin. */
  #freeSlug(input: PersistEvaluatorInput): string {
    const requested = input.slug ?? generateEvaluatorSlug(input.name);
    const taken = this.#live().some(
      (row) => row.projectId === input.projectId && row.slug === requested,
    );

    return taken ? `${requested}-${this.#rows.size + 1}` : requested;
  }

  #require(input: { id: string; projectId: string }): Evaluator {
    const row = this.#rows.get(input.id);

    if (!row || row.projectId !== input.projectId) {
      throw new Error(`Evaluator ${input.id} is not in project ${input.projectId}`);
    }

    return row;
  }
}
