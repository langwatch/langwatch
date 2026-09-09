import {
  evaluatorConfigSchema,
  evaluatorSchema,
  type Evaluator,
  type EvaluatorConfig,
  type EvaluatorCopy,
  type EvaluatorUpdateInput,
} from "@langwatch/evaluator-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
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

/** The copy lineage names the project a replica sits in, all the way up. */
const evaluatorCopySelect = {
  id: true,
  name: true,
  projectId: true,
  project: {
    select: {
      name: true,
      team: { select: { name: true, organization: { select: { name: true } } } },
    },
  },
} as const;

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

export class PrismaEvaluatorRepository
  extends PrismaRepository.for("Evaluator")
  implements EvaluatorRepository
{
  static readonly create = this.factory((prisma) => new PrismaEvaluatorRepository(prisma));

  async findById(input: { id: string; projectId: string }): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
    });

    return row ? mapRow(row as unknown as EvaluatorRow) : void 0;
  }

  async findByIdAcrossProjects(id: string): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({ where: { id, archivedAt: null } });

    return row ? mapRow(row as unknown as EvaluatorRow) : void 0;
  }

  async findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({
      where: { slug: input.slug, projectId: input.projectId, archivedAt: null },
    });

    return row ? mapRow(row as unknown as EvaluatorRow) : void 0;
  }

  async findByWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({
      where: { workflowId: input.workflowId, projectId: input.projectId, archivedAt: null },
    });

    return row ? mapRow(row as unknown as EvaluatorRow) : void 0;
  }

  async findByIdOrSlug(input: {
    idOrSlug: string;
    projectId: string;
  }): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({
      where: {
        projectId: input.projectId,
        OR: [{ slug: input.idOrSlug }, { id: input.idOrSlug }],
        archivedAt: null,
      },
    });

    return row ? mapRow(row as unknown as EvaluatorRow) : void 0;
  }

  async findAll(input: { projectId: string }): Promise<Evaluator[]> {
    const rows = await this.prisma.evaluator.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { copiedEvaluators: true } } },
    });

    return (rows as unknown[]).map((row) => mapRow(row as EvaluatorRow));
  }

  async findCopies(input: { evaluatorId: string }): Promise<EvaluatorCopy[]> {
    const rows = await this.prisma.evaluator.findMany({
      where: { copiedFromEvaluatorId: input.evaluatorId, archivedAt: null },
      select: evaluatorCopySelect,
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      projectId: row.projectId,
      fullPath: `${row.project.team.organization.name} / ${row.project.team.name} / ${row.project.name}`,
    }));
  }

  /**
   * The slug is unique inside a project, so a collision is retried with a
   * freshly derived one rather than refused: two evaluators may share a name.
   */
  async create(input: PersistEvaluatorInput): Promise<Evaluator> {
    let requestedSlug = input.slug ?? generateEvaluatorSlug(input.name);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const row = await this.prisma.evaluator.create({
          data: {
            id: input.id,
            projectId: input.projectId,
            name: input.name,
            slug: requestedSlug,
            type: input.type,
            config: input.config as unknown as Prisma.InputJsonValue,
            ...(input.workflowId !== void 0 ? { workflowId: input.workflowId } : {}),
            ...(input.copiedFromEvaluatorId !== void 0
              ? { copiedFromEvaluatorId: input.copiedFromEvaluatorId }
              : {}),
          },
        });

        return mapRow(row as unknown as EvaluatorRow);
      } catch (error) {
        if (!isSlugCollision(error)) throw error;

        requestedSlug = generateEvaluatorSlug(input.name);
      }
    }

    throw new Error("Could not allocate a unique evaluator slug");
  }

  async update(input: EvaluatorUpdateInput): Promise<Evaluator> {
    const data: Record<string, unknown> = { ...input.data };
    if (input.data.config !== void 0) {
      data.config = input.data.config as unknown as Prisma.InputJsonValue;
    }

    const row = await this.prisma.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: data as never,
    });

    return mapRow(row as unknown as EvaluatorRow);
  }

  async archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    const row = await this.prisma.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: { archivedAt: toDate(nowInstant()) },
    });

    return mapRow(row as unknown as EvaluatorRow);
  }

  async updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: EvaluatorConfig;
  }): Promise<void> {
    await this.prisma.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: { name: input.name, config: input.config as unknown as Prisma.InputJsonValue },
    });
  }
}

function isSlugCollision(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Unique constraint") &&
    error.message.includes("slug")
  );
}
