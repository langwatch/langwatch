import {
  evaluatorConfigSchema,
  evaluatorSchema,
  type Evaluator,
  type EvaluatorConfig,
  type EvaluatorCopy,
  type EvaluatorWriteAuthor,
} from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import { fromDate, nowInstant, toDate } from "@langwatch/time";

import { generateEvaluatorSlug } from "../../rules/evaluator-slug.rules.ts";
import { evaluatorVersionChanged } from "../../rules/evaluator-version.rules.ts";
import type {
  EvaluatorIdsInput,
  EvaluatorLabelRecord,
  EvaluatorRepository,
  EvaluatorVersionLookup,
  EvaluatorVersionRecord,
  PersistEvaluatorInput,
  UpdatePersistedEvaluatorInput,
} from "../evaluator.repository.ts";

/**
 * The project path a copy is listed under. Postgres reads it through the
 * project's team and organization rows, which nothing in memory holds, so the
 * twin answers the id and the same shape of path.
 */
const memoryFullPath = (projectId: string): string => `memory / memory / ${projectId}`;

export class MemoryEvaluatorRepository implements EvaluatorRepository {
  #rows = new Map<string, Evaluator>();
  #versions: EvaluatorVersionRecord[] = [];
  #labels: (Omit<EvaluatorLabelRecord, "version"> & { projectId: string })[] = [];

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

  async countActiveByProjects(input: { projectIds: string[] }): Promise<number> {
    const projectIds = new Set(input.projectIds);
    return this.#live().filter((row) => projectIds.has(row.projectId)).length;
  }

  async findAll(input: { projectId: string }): Promise<Evaluator[]> {
    return this.#live()
      .filter((row) => row.projectId === input.projectId)
      .toSorted((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
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
      createdById: input.author?.authorId ?? null,
      updatedById: input.author?.authorId ?? null,
    });

    this.#rows.set(row.id, row);
    this.#appendVersion({ evaluator: row, author: input.author, commitMessage: void 0 });

    return structuredClone(row);
  }

  async update(input: UpdatePersistedEvaluatorInput): Promise<Evaluator> {
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
    if (!evaluatorVersionChanged({ before: existing, after: updated })) {
      return structuredClone(existing);
    }
    const written = evaluatorSchema.parse({
      ...updated,
      ...(input.author ? { updatedById: input.author.authorId } : {}),
    });

    this.#rows.set(written.id, written);
    this.#appendVersion({
      evaluator: written,
      author: input.author,
      commitMessage: input.commitMessage,
    });

    return structuredClone(written);
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
    commitMessage?: string;
  }): Promise<void> {
    const existing = this.#require(input);
    const updated = evaluatorSchema.parse({
      ...existing,
      name: input.name,
      config: evaluatorConfigSchema.parse(input.config),
      updatedAt: toDate(nowInstant()),
    });
    if (!evaluatorVersionChanged({ before: existing, after: updated })) return;

    this.#rows.set(updated.id, updated);
    this.#appendVersion({ evaluator: updated, author: void 0, commitMessage: input.commitMessage });
  }

  async findVersions(input: {
    projectId: string;
    evaluatorId: string;
  }): Promise<EvaluatorVersionRecord[]> {
    return this.#versions
      .filter((row) => row.projectId === input.projectId && row.evaluatorId === input.evaluatorId)
      .toSorted((left, right) => right.version - left.version)
      .map((row) => structuredClone(row));
  }

  async findVersion(input: EvaluatorVersionLookup): Promise<EvaluatorVersionRecord | undefined> {
    const row = this.#versions.find(
      (candidate) =>
        candidate.projectId === input.projectId &&
        candidate.evaluatorId === input.evaluatorId &&
        (input.version === void 0 || candidate.version === input.version) &&
        (input.versionId === void 0 || candidate.id === input.versionId),
    );
    return row ? structuredClone(row) : void 0;
  }

  async latestVersionNumbers(input: EvaluatorIdsInput): Promise<Map<string, number>> {
    const numbers = new Map<string, number>();
    for (const row of this.#versions) {
      if (row.projectId !== input.projectId || !input.ids.includes(row.evaluatorId)) continue;
      numbers.set(row.evaluatorId, Math.max(numbers.get(row.evaluatorId) ?? 0, row.version));
    }
    return numbers;
  }

  async findLabels(input: EvaluatorIdsInput): Promise<EvaluatorLabelRecord[]> {
    return this.#labels
      .filter((row) => row.projectId === input.projectId && input.ids.includes(row.evaluatorId))
      .toSorted((left, right) => left.label.localeCompare(right.label))
      .flatMap(({ projectId: _projectId, ...label }) => {
        const version = this.#versions.find((row) => row.id === label.versionId);
        return version ? [{ ...label, version: version.version }] : [];
      });
  }

  async assignLabel(input: {
    projectId: string;
    evaluatorId: string;
    label: string;
    versionId: string;
    actorId: string | null;
  }): Promise<EvaluatorLabelRecord> {
    const version = await this.findVersion({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      versionId: input.versionId,
    });
    if (!version) throw new Error(`Version ${input.versionId} is not on ${input.evaluatorId}`);
    const row = {
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      label: input.label,
      versionId: version.id,
      updatedAt: nowInstant(),
      updatedById: input.actorId,
    };
    this.#labels = [
      ...this.#labels.filter(
        (candidate) =>
          !(candidate.evaluatorId === input.evaluatorId && candidate.label === input.label),
      ),
      row,
    ];
    const { projectId: _projectId, ...label } = row;
    return { ...label, version: version.version };
  }

  async removeLabel(input: {
    projectId: string;
    evaluatorId: string;
    label: string;
  }): Promise<boolean> {
    const before = this.#labels.length;
    this.#labels = this.#labels.filter(
      (row) =>
        !(
          row.projectId === input.projectId &&
          row.evaluatorId === input.evaluatorId &&
          row.label === input.label
        ),
    );
    return this.#labels.length < before;
  }

  async findUnversioned(input: { afterId: string | null; limit: number }): Promise<Evaluator[]> {
    return this.#live()
      .filter((row) => input.afterId === null || row.id > input.afterId)
      .toSorted((left, right) => (left.id < right.id ? -1 : 1))
      .slice(0, input.limit)
      .map((row) => structuredClone(row));
  }

  async backfillFirstVersion(input: {
    evaluator: Evaluator;
    createdById: string | null;
  }): Promise<boolean> {
    const { evaluator } = input;
    if (this.#versions.some((row) => row.evaluatorId === evaluator.id)) return false;
    this.#versions.push({
      id: generate("evaluatorversion").toString(),
      evaluatorId: evaluator.id,
      projectId: evaluator.projectId,
      version: 1,
      name: evaluator.name,
      type: evaluator.type,
      config: structuredClone(evaluatorConfigSchema.parse(evaluator.config ?? {})),
      workflowId: evaluator.workflowId,
      commitMessage: null,
      authorId: input.createdById,
      authorKind: input.createdById ? "user" : "system",
      createdAt: fromDate(evaluator.createdAt),
    });
    const stored = this.#rows.get(evaluator.id);
    if (stored && input.createdById && !stored.createdById) {
      this.#rows.set(evaluator.id, { ...stored, createdById: input.createdById });
    }
    return true;
  }

  /** Test seam: a row as an older release wrote it, with no versions and no creator. */
  seedUnversioned(evaluator: Evaluator): void {
    this.#rows.set(evaluator.id, structuredClone(evaluator));
  }

  #appendVersion(input: {
    evaluator: Evaluator;
    author: EvaluatorWriteAuthor | undefined;
    commitMessage: string | undefined;
  }): void {
    const { evaluator } = input;
    const latest = this.#versions
      .filter((row) => row.evaluatorId === evaluator.id)
      .reduce((max, row) => Math.max(max, row.version), 0);
    this.#versions.push({
      id: generate("evaluatorversion").toString(),
      evaluatorId: evaluator.id,
      projectId: evaluator.projectId,
      version: latest + 1,
      name: evaluator.name,
      type: evaluator.type,
      config: structuredClone(evaluatorConfigSchema.parse(evaluator.config ?? {})),
      workflowId: evaluator.workflowId,
      commitMessage: input.commitMessage ?? null,
      authorId: input.author?.authorId ?? null,
      authorKind: input.author?.authorKind ?? "system",
      createdAt: nowInstant(),
    });
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
    let slug = input.slug ?? generateEvaluatorSlug(input.name);

    while (this.#live().some((row) => row.projectId === input.projectId && row.slug === slug)) {
      slug = generateEvaluatorSlug(input.name);
    }

    return slug;
  }

  #require(input: { id: string; projectId: string }): Evaluator {
    const row = this.#rows.get(input.id);

    if (!row || row.projectId !== input.projectId) {
      throw new Error(`Evaluator ${input.id} is not in project ${input.projectId}`);
    }

    return row;
  }
}
