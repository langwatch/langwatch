import type { Prisma } from "@langwatch/prisma-client/generated";
import {
  evaluatorConfigSchema,
  evaluatorSchema,
  type Evaluator,
  type EvaluatorConfig,
  type EvaluatorCopy,
  type EvaluatorUpdateInput,
} from "@langwatch/evaluator-contract";
import {
  EvaluatorRepository,
  type EvaluatorDatabase,
  type PersistEvaluatorInput,
} from "../evaluator.repository";

const generateEvaluatorSlug = (name: string): string => {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "evaluator";
};

type EvaluatorRow = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  type: unknown;
  config: unknown;
  workflowId: string | null;
  copiedFromEvaluatorId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { copiedEvaluators: number };
};

function mapRow(row: EvaluatorRow): Evaluator {
  const config = row.config === null ? null : evaluatorConfigSchema.parse(row.config);
  return evaluatorSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    slug: row.slug,
    type: row.type,
    config,
    workflowId: row.workflowId,
    copiedFromEvaluatorId: row.copiedFromEvaluatorId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row._count
      ? {
          copyCount: row._count.copiedEvaluators,
          _count: { copiedEvaluators: row._count.copiedEvaluators },
        }
      : {}),
  });
}

export class PrismaEvaluatorRepository extends EvaluatorRepository {
  static create(database: EvaluatorDatabase): PrismaEvaluatorRepository {
    return new PrismaEvaluatorRepository(database);
  }
  private constructor(private readonly database: EvaluatorDatabase) {
    super();
  }

  async tryFindById(input: { id: string; projectId: string }): Promise<Evaluator | null> {
    const row = await this.database.evaluator.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
    });
    return row ? mapRow(row as unknown as EvaluatorRow) : null;
  }
  async tryFindByIdOnly(id: string): Promise<Evaluator | null> {
    const row = await this.database.evaluator.findFirst({
      where: { id, archivedAt: null },
    });
    return row ? mapRow(row as unknown as EvaluatorRow) : null;
  }
  async tryFindBySlug(input: {
    slug: string;
    projectId: string;
  }): Promise<Evaluator | null> {
    const row = await this.database.evaluator.findFirst({
      where: { slug: input.slug, projectId: input.projectId, archivedAt: null },
    });
    return row ? mapRow(row as unknown as EvaluatorRow) : null;
  }
  async tryFindByWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Evaluator | null> {
    const row = await this.database.evaluator.findFirst({
      where: {
        workflowId: input.workflowId,
        projectId: input.projectId,
        archivedAt: null,
      },
    });
    return row ? mapRow(row as unknown as EvaluatorRow) : null;
  }
  async findAll(input: { projectId: string }): Promise<Evaluator[]> {
    const rows = await this.database.evaluator.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { copiedEvaluators: true } } },
    });
    return (rows as unknown[]).map((row) => mapRow(row as EvaluatorRow));
  }
  async create(input: PersistEvaluatorInput): Promise<Evaluator> {
    let requestedSlug = input.slug ?? generateEvaluatorSlug(input.name);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const row = await this.database.evaluator.create({
          data: {
            id: input.id,
            projectId: input.projectId,
            name: input.name,
            slug: requestedSlug,
            type: input.type,
            config: input.config as unknown as Prisma.InputJsonValue,
            ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
            ...(input.copiedFromEvaluatorId !== undefined
              ? { copiedFromEvaluatorId: input.copiedFromEvaluatorId }
              : {}),
          },
        });
        return mapRow(row as unknown as EvaluatorRow);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Unique constraint") ||
          !error.message.includes("slug")
        )
          throw error;
        requestedSlug = generateEvaluatorSlug(input.name);
      }
    }
    throw new Error("Could not allocate a unique evaluator slug");
  }
  async update(input: EvaluatorUpdateInput): Promise<Evaluator> {
    const data: Record<string, unknown> = { ...input.data };
    if (input.data.config !== undefined) {
      data.config = input.data.config as unknown as Prisma.InputJsonValue;
    }
    const row = await this.database.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: data as never,
    });
    return mapRow(row as unknown as EvaluatorRow);
  }
  async archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    const row = await this.database.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: { archivedAt: new Date() },
    });
    return mapRow(row as unknown as EvaluatorRow);
  }
  async findCopies(input: { evaluatorId: string }): Promise<EvaluatorCopy[]> {
    const rows = await this.database.evaluator.findMany({
      where: { copiedFromEvaluatorId: input.evaluatorId, archivedAt: null },
      select: {
        id: true,
        name: true,
        projectId: true,
        project: {
          select: {
            name: true,
            team: { select: { name: true, organization: { select: { name: true } } } },
          },
        },
      },
    });
    return (
      rows as unknown as Array<{
        id: string;
        name: string;
        projectId: string;
        project: { name: string; team: { name: string; organization: { name: string } } };
      }>
    ).map((row) => ({
      id: row.id,
      name: row.name,
      projectId: row.projectId,
      fullPath: `${row.project.team.organization.name} / ${row.project.team.name} / ${row.project.name}`,
    }));
  }
  async updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: EvaluatorConfig;
  }): Promise<void> {
    await this.database.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: {
        name: input.name,
        config: input.config as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
