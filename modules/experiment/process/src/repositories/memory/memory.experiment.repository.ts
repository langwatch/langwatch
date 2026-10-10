import {
  experimentRowWithoutHttpCredentials,
  experimentSchema,
  ExperimentNotFoundError,
  ExperimentTypeMismatchError,
  ExperimentVersionNotFoundError,
  type Experiment,
  type ExperimentType,
  type ExperimentUsageCount,
  type SaveExperimentInput,
  type WorkbenchActor,
  type WorkbenchStateView,
  type WorkbenchVersionSummary,
  workbenchStateWithoutHttpCredentials,
} from "@langwatch/experiment-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";

import { isEvaluationsWorkbench } from "../../rules/experiment-workbench-type.rules.ts";
import {
  ArchivedExperimentWriteError,
  ExperimentRepository,
  type ExperimentRowState,
  type WorkbenchWriteResult,
} from "../experiment.repository.ts";

type VersionRow = WorkbenchVersionSummary & {
  id: string;
  projectId: string;
  experimentId: string;
  runId: string | null;
  state: unknown;
};

/** A unique-constraint refusal shaped as Postgres reports it, so the services' retries run. */
class MemoryUniqueConflictError extends Error {
  readonly code = "P2002";

  constructor(readonly meta: { target: string[] }) {
    super(`Unique constraint failed on the fields: (${meta.target.join(", ")})`);
    this.name = "MemoryUniqueConflictError";
  }
}

const now = () => toDate(nowInstant());
const asJson = (value: unknown): Experiment["workbenchState"] =>
  value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Experiment["workbenchState"]);
const mapExperiment = (row: Experiment): Experiment =>
  experimentSchema.parse(experimentRowWithoutHttpCredentials(structuredClone(row)));
const newestFirst = (left: Experiment, right: Experiment): number =>
  right.updatedAt.getTime() - left.updatedAt.getTime() || right.id.localeCompare(left.id);

/** Experiments and their workbench versions in this process's memory, with the same fences. */
export class MemoryExperimentRepository extends ExperimentRepository {
  static create(): MemoryExperimentRepository {
    return new MemoryExperimentRepository();
  }

  private readonly rows = new Map<string, Experiment>();
  private versions: VersionRow[] = [];
  private nextVersionId = 1;

  private constructor() {
    super();
  }

  findById(input: { id: string; projectId: string }): Promise<Experiment | null> {
    return this.first((row) => row.id === input.id && row.projectId === input.projectId);
  }

  findBySlug(input: {
    slug: string;
    projectId: string;
    type?: ExperimentType;
  }): Promise<Experiment | null> {
    return this.first(
      (row) =>
        row.slug === input.slug &&
        row.projectId === input.projectId &&
        (input.type === undefined || row.type === input.type),
    );
  }

  findAll(input: { projectId: string }): Promise<Experiment[]> {
    return Promise.resolve(this.active(input.projectId).toSorted(newestFirst).map(mapExperiment));
  }

  async findPage(input: { projectId: string; skip: number; take: number }): Promise<Experiment[]> {
    return (await this.findAll(input)).slice(input.skip, input.skip + input.take);
  }

  count(input: { projectId: string }): Promise<number> {
    return Promise.resolve(this.active(input.projectId).length);
  }

  countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<ExperimentUsageCount> {
    const scoped = [...this.rows.values()].filter((row) => projectIds.includes(row.projectId));
    const experiments = scoped.filter(
      (row) => since === undefined || row.createdAt.getTime() >= since,
    ).length;
    const first = Math.min(...scoped.map((row) => row.createdAt.getTime()));
    return Promise.resolve({
      experiments,
      ...(scoped.length > 0 ? { firstExperimentAt: first } : {}),
    });
  }

  findLatest(input: { projectId: string }): Promise<Experiment | null> {
    const latest = this.active(input.projectId).toSorted(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )[0];
    return Promise.resolve(latest ? mapExperiment(latest) : null);
  }

  findForWorkflow(input: { projectId: string; workflowId: string }): Promise<Experiment | null> {
    return this.first(
      (row) =>
        row.projectId === input.projectId &&
        row.workflowId === input.workflowId &&
        row.type === "EVALUATIONS_V3",
    );
  }

  async findIdBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<{ id: string; slug: string } | null> {
    const found = await this.findBySlug(input);
    return found ? { id: found.id, slug: found.slug } : null;
  }

  async findBySlugOrId(input: { projectId: string; slugOrId: string }): Promise<Experiment> {
    const found =
      (await this.findBySlug({ projectId: input.projectId, slug: input.slugOrId })) ??
      (await this.findById({ projectId: input.projectId, id: input.slugOrId }));
    if (!found) throw new ExperimentNotFoundError(input.slugOrId);
    return found;
  }

  findRowState(input: { projectId: string; id: string }): Promise<ExperimentRowState | null> {
    const row = this.owned(input);
    return Promise.resolve(
      row
        ? { slug: row.slug, workflowId: row.workflowId, archived: row.archivedAt !== null }
        : null,
    );
  }

  findSlugsByPrefix(input: {
    projectId: string;
    slugPrefix: string;
    excludeId?: string;
  }): Promise<string[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter(
          (row) =>
            row.projectId === input.projectId &&
            row.slug.startsWith(input.slugPrefix) &&
            row.id !== input.excludeId,
        )
        .map((row) => row.slug),
    );
  }

  findDraftNames(input: { projectId: string }): Promise<{ name: string | null }[]> {
    return Promise.resolve(
      this.active(input.projectId)
        .filter((row) => row.name?.startsWith("Draft") === true)
        .map((row) => ({ name: row.name })),
    );
  }

  findAllSlugs(input: { projectId: string }): Promise<string[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.projectId === input.projectId)
        .map((row) => row.slug),
    );
  }

  async saveActive(input: SaveExperimentInput & { slug: string }): Promise<Experiment> {
    const existing = this.owned(input);
    if (existing?.archivedAt) throw new ArchivedExperimentWriteError(input.id);
    if (!existing && this.rows.has(input.id))
      throw new MemoryUniqueConflictError({ target: ["id"] });
    this.assertSlugFree({ projectId: input.projectId, slug: input.slug, id: input.id });
    const timestamp = now();
    const row: Experiment = {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      slug: input.slug,
      workflowId: input.workflowId ?? null,
      workbenchState: asJson(input.workbenchState),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      workbenchVersion: existing?.workbenchVersion ?? 0,
    };
    this.rows.set(row.id, row);
    return mapExperiment(row);
  }

  async updateWorkbenchState(input: {
    projectId: string;
    id: string;
    workbenchState: SaveExperimentInput["workbenchState"];
  }): Promise<{ version: number }> {
    const row = this.owned(input);
    if (!row) throw new ExperimentNotFoundError(input.id);
    row.workbenchState = asJson(input.workbenchState);
    row.workbenchVersion += 1;
    row.updatedAt = now();
    return { version: row.workbenchVersion };
  }

  archiveActive(input: {
    projectId: string;
    id: string;
    archivedSlug: string;
    archivedAt: Instant;
  }): Promise<boolean> {
    const row = this.owned(input);
    if (!row || row.archivedAt) return Promise.resolve(false);
    row.archivedAt = toDate(input.archivedAt);
    row.slug = input.archivedSlug;
    row.updatedAt = now();
    return Promise.resolve(true);
  }

  async findWorkbenchState(input: {
    projectId: string;
    id?: string;
    slug?: string;
  }): Promise<WorkbenchStateView> {
    if (!input.id && !input.slug) throw new ExperimentNotFoundError("");
    const row = this.active(input.projectId).find(
      (candidate) =>
        (input.id === undefined || candidate.id === input.id) &&
        (input.slug === undefined || candidate.slug === input.slug),
    );
    if (!row) throw new ExperimentNotFoundError(input.id ?? input.slug ?? "");
    if (!isEvaluationsWorkbench(row)) throw new ExperimentTypeMismatchError();
    const author = this.versionAt(row);
    return {
      experimentId: row.id,
      slug: row.slug,
      name: row.name,
      state: workbenchStateWithoutHttpCredentials(
        structuredClone(row.workbenchState),
      ) as WorkbenchStateView["state"],
      version: row.workbenchVersion,
      updatedAt: row.updatedAt,
      ...(author ? { actorLabel: author.authorLabel as "user" | "langy" | "api" } : {}),
      ...(author?.runId ? { runId: author.runId } : {}),
    };
  }

  async resolveWorkbenchSaveTarget(input: {
    projectId: string;
    id?: string;
    slug?: string;
  }): Promise<{ kind: "create"; id?: string } | { kind: "update"; state: WorkbenchStateView }> {
    if (input.id) {
      const row = this.owned({ projectId: input.projectId, id: input.id });
      if (!row) return { kind: "create", id: input.id };
      if (row.archivedAt) throw new ExperimentNotFoundError(input.id);
      return {
        kind: "update",
        state: await this.findWorkbenchState({ projectId: input.projectId, id: input.id }),
      };
    }
    if (input.slug) {
      return {
        kind: "update",
        state: await this.findWorkbenchState({ projectId: input.projectId, slug: input.slug }),
      };
    }
    return { kind: "create" };
  }

  async writeWorkbenchState(input: {
    projectId: string;
    id: string;
    name: string;
    state: unknown;
    snapshot: unknown;
    expectedVersion?: number;
    actor: WorkbenchActor;
    commitMessage?: string;
  }): Promise<WorkbenchWriteResult> {
    const row = this.owned(input);
    if (!row || row.archivedAt) throw new ExperimentNotFoundError(input.id);
    if (!isEvaluationsWorkbench(row)) throw new ExperimentTypeMismatchError();
    if (input.expectedVersion !== undefined && input.expectedVersion !== row.workbenchVersion) {
      const author = this.versionAt(row);
      return {
        kind: "stale",
        currentVersion: row.workbenchVersion,
        ...(author ? { actorLabel: author.authorLabel } : {}),
        ...(author?.runId ? { runId: author.runId } : {}),
      };
    }
    const nextVersion = row.workbenchVersion + 1;
    row.name = input.name;
    row.workbenchState = asJson(input.state);
    row.workbenchVersion = nextVersion;
    row.updatedAt = now();
    this.recordWorkbenchVersion({ input, experimentId: row.id, nextVersion });
    return {
      kind: "saved",
      experimentId: row.id,
      slug: row.slug,
      version: nextVersion,
    };
  }

  async createWorkbenchState(input: {
    projectId: string;
    id: string;
    slug: string;
    name: string;
    state: unknown;
    snapshot: unknown;
    actor: WorkbenchActor;
    commitMessage?: string;
  }): Promise<{ id: string; slug: string }> {
    if (this.rows.has(input.id)) throw new MemoryUniqueConflictError({ target: ["id"] });
    this.assertSlugFree(input);
    const timestamp = now();
    this.rows.set(input.id, {
      id: input.id,
      projectId: input.projectId,
      slug: input.slug,
      name: input.name,
      type: "EVALUATIONS_V3",
      workflowId: null,
      workbenchState: asJson(input.state),
      workbenchVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    });
    this.versions.push(
      this.versionRow({
        input,
        experimentId: input.id,
        version: 1,
        counterVersion: 1,
        autoSaved: false,
      }),
    );
    return { id: input.id, slug: input.slug };
  }

  findWorkbenchVersions(input: {
    projectId: string;
    experimentId: string;
    take: number;
    beforeCounterVersion?: number;
  }): Promise<WorkbenchVersionSummary[]> {
    return Promise.resolve(
      this.versionsOf(input)
        .filter(
          (row) =>
            input.beforeCounterVersion === undefined ||
            row.counterVersion < input.beforeCounterVersion,
        )
        .slice(0, input.take)
        .map((row) => ({
          version: row.version,
          counterVersion: row.counterVersion,
          autoSaved: row.autoSaved,
          commitMessage: row.commitMessage,
          authorId: row.authorId,
          authorLabel: row.authorLabel,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
    );
  }

  hasWorkbenchVersionOfRun(input: {
    projectId: string;
    experimentId: string;
    runId: string;
  }): Promise<boolean> {
    return Promise.resolve(this.versionsOf(input).some((row) => row.runId === input.runId));
  }

  async findWorkbenchVersion(input: {
    projectId: string;
    experimentId: string;
    version: number;
  }): Promise<{ autoSaved: boolean; state: unknown }> {
    const found = this.versionsOf(input).find((row) => row.version === input.version);
    if (!found) {
      throw new ExperimentVersionNotFoundError({
        experimentId: input.experimentId,
        version: input.version,
      });
    }
    return { autoSaved: found.autoSaved, state: structuredClone(found.state) };
  }

  /** Rolls the auto-saved version forward, or writes a new version row beside it. */
  private recordWorkbenchVersion({
    input,
    experimentId,
    nextVersion,
  }: {
    input: { projectId: string; snapshot: unknown; actor: WorkbenchActor; commitMessage?: string };
    experimentId: string;
    nextVersion: number;
  }): void {
    const autoSaved = input.actor.label === "user" && !input.commitMessage;
    const scope = { projectId: input.projectId, experimentId };
    const rolling = this.versionsOf(scope).find((row) => row.autoSaved);
    if (autoSaved && rolling) {
      Object.assign(rolling, {
        version: nextVersion,
        counterVersion: nextVersion,
        state: structuredClone(input.snapshot),
        authorId: input.actor.userId ?? null,
        authorLabel: input.actor.label,
        runId: input.actor.runId ?? null,
        commitMessage: null,
        updatedAt: now(),
      });
      return;
    }
    if (rolling) Object.assign(rolling, { version: nextVersion, updatedAt: now() });
    const highest = this.versionsOf(scope)
      .filter((row) => !row.autoSaved)
      .reduce((max, row) => Math.max(max, row.version), 0);
    this.versions.push(
      this.versionRow({
        input,
        experimentId,
        version: autoSaved ? nextVersion : highest + 1,
        counterVersion: nextVersion,
        autoSaved,
      }),
    );
  }

  private versionRow({
    input,
    experimentId,
    version,
    counterVersion,
    autoSaved,
  }: {
    input: { projectId: string; snapshot: unknown; actor: WorkbenchActor; commitMessage?: string };
    experimentId: string;
    version: number;
    counterVersion: number;
    autoSaved: boolean;
  }): VersionRow {
    const timestamp = now();
    return {
      id: `experiment_version_${this.nextVersionId++}`,
      projectId: input.projectId,
      experimentId,
      version,
      counterVersion,
      autoSaved,
      commitMessage: input.commitMessage ?? null,
      authorId: input.actor.userId ?? null,
      authorLabel: input.actor.label,
      runId: input.actor.runId ?? null,
      state: structuredClone(input.snapshot),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /** One experiment's versions, newest counter first. */
  private versionsOf(input: { projectId: string; experimentId: string }): VersionRow[] {
    return this.versions
      .filter((row) => row.projectId === input.projectId && row.experimentId === input.experimentId)
      .toSorted((left, right) => right.counterVersion - left.counterVersion);
  }

  private versionAt(row: Experiment): VersionRow | undefined {
    return this.versionsOf({ projectId: row.projectId, experimentId: row.id }).find(
      (version) => version.counterVersion === row.workbenchVersion,
    );
  }

  private assertSlugFree(input: { projectId: string; slug: string; id: string }): void {
    const taken = [...this.rows.values()].some(
      (row) => row.projectId === input.projectId && row.slug === input.slug && row.id !== input.id,
    );
    if (taken) throw new MemoryUniqueConflictError({ target: ["projectId", "slug"] });
  }

  private owned(input: { projectId: string; id: string }): Experiment | undefined {
    const row = this.rows.get(input.id);
    return row?.projectId === input.projectId ? row : undefined;
  }

  private active(projectId: string): Experiment[] {
    return [...this.rows.values()].filter(
      (row) => row.projectId === projectId && row.archivedAt === null,
    );
  }

  private first(matches: (row: Experiment) => boolean): Promise<Experiment | null> {
    const row = [...this.rows.values()].find(
      (candidate) => !candidate.archivedAt && matches(candidate),
    );
    return Promise.resolve(row ? mapExperiment(row) : null);
  }
}
