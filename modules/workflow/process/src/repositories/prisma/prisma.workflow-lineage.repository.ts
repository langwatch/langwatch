import {
  workflowProjectPathSchema,
  workflowSchema,
  type Workflow,
  type WorkflowCopiesRow,
  type WorkflowCopyWithPath,
  type WorkflowLineageRow,
  type WorkflowPublicationFlags,
  type WorkflowSourceRow,
} from "@langwatch/workflow-contract";
import { z } from "zod";

import { WorkflowLineageRepository } from "../workflow-lineage.repository.ts";

/** The workflow and version tables, named structurally so Prisma types stay here. */
export type WorkflowLineageDatabase = {
  workflow: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    update(args: unknown): Promise<unknown>;
  };
  workflowVersion: {
    findFirst(args: unknown): Promise<unknown>;
  };
};

type WorkflowScope = Readonly<{ workflowId: string; projectId: string }>;

const copyPathSelect = {
  id: true,
  name: true,
  projectId: true,
  project: {
    select: {
      id: true,
      name: true,
      team: {
        select: { id: true, name: true, organization: { select: { id: true, name: true } } },
      },
    },
  },
} as const;

const versionRowSchema = z.object({ version: z.string(), dsl: z.unknown() }).nullable();
const copyPathSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  project: workflowProjectPathSchema,
});
const lineageRowsSchema = z.array(
  z.object({
    ...workflowSchema.shape,
    copiedFrom: copyPathSchema.nullable(),
    copiedWorkflows: z.array(z.object({ projectId: z.string() })),
  }),
);
const withLatestVersionSchema = z.object({
  ...workflowSchema.shape,
  latestVersion: versionRowSchema,
});
const sourceRowSchema = z
  .object({ ...withLatestVersionSchema.shape, copiedFrom: withLatestVersionSchema.nullable() })
  .nullable();
const copiesRowSchema = z
  .object({ ...withLatestVersionSchema.shape, copiedWorkflows: z.array(withLatestVersionSchema) })
  .nullable();
const copiesWithPathSchema = z.object({ copiedWorkflows: z.array(copyPathSchema) }).nullable();
const projectIdSchema = z.object({ projectId: z.string() }).nullable();
const latestVersionNumberSchema = z
  .object({ latestVersion: z.object({ version: z.string() }).nullable() })
  .nullable();
const flagsSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    publishedId: z.string().nullable(),
    isComponent: z.boolean(),
    isEvaluator: z.boolean(),
  })
  .nullable();
const componentRowsSchema = z.array(
  z.object({ ...workflowSchema.shape, versions: z.array(z.object({ id: z.string() }).loose()) }),
);
const versionRecordSchema = z.record(z.string(), z.unknown()).nullable();

export class PrismaWorkflowLineageRepository extends WorkflowLineageRepository {
  static create(options: { database: WorkflowLineageDatabase }): PrismaWorkflowLineageRepository {
    return new PrismaWorkflowLineageRepository(options.database);
  }

  private constructor(private readonly database: WorkflowLineageDatabase) {
    super();
  }

  async findWithCopyLineage(input: { projectId: string }): Promise<readonly WorkflowLineageRow[]> {
    const rows = await this.database.workflow.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: {
        copiedFrom: { select: copyPathSelect },
        copiedWorkflows: { where: { archivedAt: null }, select: { projectId: true } },
      },
    });

    return lineageRowsSchema.parse(rows);
  }

  async findWorkflow(input: WorkflowScope): Promise<Readonly<{ projectId: string }> | null> {
    const row = await this.database.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
      select: { projectId: true },
    });

    return projectIdSchema.parse(row);
  }

  async findCopiesWithPath(input: WorkflowScope): Promise<readonly WorkflowCopyWithPath[] | null> {
    const row = await this.database.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId },
      select: { copiedWorkflows: { where: { archivedAt: null }, select: copyPathSelect } },
    });

    return copiesWithPathSchema.parse(row)?.copiedWorkflows ?? null;
  }

  async findWorkflowWithSource(input: WorkflowScope): Promise<WorkflowSourceRow | null> {
    const row = await this.database.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
      include: { latestVersion: true, copiedFrom: { include: { latestVersion: true } } },
    });

    return sourceRowSchema.parse(row);
  }

  async findWorkflowWithCopies(input: WorkflowScope): Promise<WorkflowCopiesRow | null> {
    const row = await this.database.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
      include: {
        latestVersion: true,
        copiedWorkflows: { where: { archivedAt: null }, include: { latestVersion: true } },
      },
    });

    return copiesRowSchema.parse(row);
  }

  async findLatestVersionNumber(
    input: WorkflowScope,
  ): Promise<Readonly<{ version: string | null }> | null> {
    const row = await this.database.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId },
      select: { latestVersion: { select: { version: true } } },
    });
    const parsed = latestVersionNumberSchema.parse(row);

    return parsed ? { version: parsed.latestVersion?.version ?? null } : null;
  }

  async findFlags(input: WorkflowScope): Promise<WorkflowPublicationFlags | null> {
    const row = await this.database.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId },
      select: { id: true, name: true, publishedId: true, isComponent: true, isEvaluator: true },
    });

    return flagsSchema.parse(row);
  }

  async findVersion(input: {
    versionId: string;
    projectId: string;
  }): Promise<Readonly<Record<string, unknown>> | null> {
    const row = await this.database.workflowVersion.findFirst({
      where: { id: input.versionId, projectId: input.projectId },
    });

    return versionRecordSchema.parse(row);
  }

  async setFlags(
    input: WorkflowScope & { isComponent?: boolean; isEvaluator?: boolean },
  ): Promise<void> {
    await this.database.workflow.update({
      where: { id: input.workflowId, projectId: input.projectId },
      data: {
        ...(input.isComponent === undefined ? {} : { isComponent: input.isComponent }),
        ...(input.isEvaluator === undefined ? {} : { isEvaluator: input.isEvaluator }),
      },
    });
  }

  async findPublishedComponents(input: {
    projectId: string;
  }): Promise<readonly (Workflow & { versions: readonly unknown[] })[]> {
    const rows = componentRowsSchema.parse(
      await this.database.workflow.findMany({
        where: { projectId: input.projectId, OR: [{ isComponent: true }, { isEvaluator: true }] },
        include: { versions: true },
      }),
    );

    return rows.map((row) => ({
      ...row,
      versions: row.versions.filter((version) => version.id === row.publishedId),
    }));
  }
}
