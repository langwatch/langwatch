import {
  workflowDslSchema,
  workflowSchema,
  workflowVersionSchema,
  type Workflow,
  type WorkflowVersion,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import {
  WorkflowRepository,
  type PersistWorkflowInput,
  type PersistWorkflowVersionInput,
} from "../workflow.repository";

/** Narrow database shape keeps generated Prisma types inside this directory. */
export type WorkflowDatabase = {
  workflow: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  workflowVersion: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

type WorkflowRow = Omit<Workflow, "latestVersionId" | "currentVersionId" | "publishedId" | "publishedById" | "copiedFromWorkflowId"> & {
  latestVersionId?: string | null;
  currentVersionId?: string | null;
  publishedId?: string | null;
  publishedById?: string | null;
  copiedFromWorkflowId?: string | null;
};

type VersionRow = Omit<WorkflowVersion, "dsl"> & { dsl?: unknown };

const mapWorkflow = (row: unknown): Workflow => {
  const value = row as WorkflowRow;
  return workflowSchema.parse({
    ...value,
    latestVersionId: value.latestVersionId ?? null,
    currentVersionId: value.currentVersionId ?? null,
    publishedId: value.publishedId ?? null,
    publishedById: value.publishedById ?? null,
    copiedFromWorkflowId: value.copiedFromWorkflowId ?? null,
  });
};

const mapVersion = (row: unknown, includeDsl = true): WorkflowVersion => {
  const value = row as VersionRow;
  return workflowVersionSchema.parse({
    ...value,
    dsl: includeDsl ? workflowDslSchema.parse(value.dsl) : { name: "", version: value.version, nodes: [], edges: [] },
  });
};

export class PrismaWorkflowRepository extends WorkflowRepository {
  static create(database: WorkflowDatabase): PrismaWorkflowRepository {
    return new PrismaWorkflowRepository(database);
  }

  private constructor(private readonly database: WorkflowDatabase) {
    super();
  }

  async tryFindById(input: { id: string; projectId: string; includeVersion?: boolean }): Promise<WorkflowWithVersion | null> {
    const row = await this.database.workflow.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
      ...(input.includeVersion ? { include: { currentVersion: true, latestVersion: true } } : {}),
    });
    if (!row) return null;
    const value = row as { currentVersion?: unknown; latestVersion?: unknown };
    return {
      ...mapWorkflow(row),
      ...(input.includeVersion ? {
        currentVersion: value.currentVersion ? mapVersion(value.currentVersion) : null,
        latestVersion: value.latestVersion ? mapVersion(value.latestVersion) : null,
      } : {}),
    };
  }

  async findAll(input: { projectId: string }): Promise<Workflow[]> {
    const rows = await this.database.workflow.findMany({
      where: { projectId: input.projectId, archivedAt: null }, orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapWorkflow);
  }

  async findVersions(input: { workflowId: string; projectId: string; includeDsl?: boolean }): Promise<WorkflowVersion[]> {
    const rows = await this.database.workflowVersion.findMany({
      where: { workflowId: input.workflowId, projectId: input.projectId }, orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => mapVersion(row, input.includeDsl !== false));
  }

  async tryFindVersion(input: { id: string; workflowId: string; projectId: string }): Promise<WorkflowVersion | null> {
    const row = await this.database.workflowVersion.findFirst({ where: { id: input.id, workflowId: input.workflowId, projectId: input.projectId } });
    return row ? mapVersion(row) : null;
  }

  async tryFindPublishedVersion(input: { workflowId: string; projectId: string; versionId?: string }): Promise<WorkflowVersion | null> {
    const workflow = await this.database.workflow.findFirst({ where: { id: input.workflowId, projectId: input.projectId, archivedAt: null }, select: { publishedId: true } }) as { publishedId?: string | null } | null;
    const id = input.versionId ?? workflow?.publishedId;
    if (!id) return null;
    return this.tryFindVersion({ id, workflowId: input.workflowId, projectId: input.projectId });
  }

  async createWorkflow(input: PersistWorkflowInput): Promise<WorkflowWithVersion> {
    return { ...mapWorkflow(await this.database.workflow.create({ data: input })), currentVersion: null, latestVersion: null };
  }

  async updateWorkflow(input: { id: string; projectId: string; data: Record<string, unknown> }): Promise<Workflow> {
    return mapWorkflow(await this.database.workflow.update({ where: { id: input.id, projectId: input.projectId }, data: input.data }));
  }

  async createVersion(input: PersistWorkflowVersionInput): Promise<WorkflowVersion> {
    return mapVersion(await this.database.workflowVersion.create({ data: { ...input, dsl: input.dsl } }));
  }

  async updateAutoSavedVersion(input: PersistWorkflowVersionInput & { id: string }): Promise<WorkflowVersion> {
    return mapVersion(await this.database.workflowVersion.update({ where: { id: input.id, projectId: input.projectId }, data: { ...input, id: undefined } }));
  }

  async setVersionPointers(input: { id: string; projectId: string; currentVersionId: string; latestVersionId?: string | null }): Promise<void> {
    await this.database.workflow.update({ where: { id: input.id, projectId: input.projectId }, data: { currentVersionId: input.currentVersionId, ...(input.latestVersionId !== undefined ? { latestVersionId: input.latestVersionId } : {}) } });
  }

  async publish(input: { id: string; projectId: string; versionId: string; actorId?: string }): Promise<Workflow> {
    return mapWorkflow(await this.database.workflow.update({ where: { id: input.id, projectId: input.projectId }, data: { publishedId: input.versionId, ...(input.actorId ? { publishedById: input.actorId } : {}) } }));
  }

  async findCopies(input: { workflowId: string; projectId: string }): Promise<Workflow[]> {
    const rows = await this.database.workflow.findMany({ where: { copiedFromWorkflowId: input.workflowId, archivedAt: null } });
    return rows.map(mapWorkflow);
  }
}
