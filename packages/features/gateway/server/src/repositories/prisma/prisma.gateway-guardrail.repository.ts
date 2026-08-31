import {
  gatewayGuardrailResourceSchema,
  gatewayGuardrailBundleEntrySchema,
  type ArchiveGatewayGuardrailInput,
  type CreateGatewayGuardrailInput,
  type GatewayGuardrailResource,
  type GatewayGuardrailBundleEntry,
  type UpdateGatewayGuardrailInput,
} from "@langwatch/gateway-contract";
import { type GatewayGuardrail, type PrismaClient } from "@langwatch/prisma-client/generated";
import { GatewayGuardrailRepository } from "../gateway-guardrail.repository";

/** Private Prisma mapping for Gateway's project-scoped guardrail catalogue. */
export class PrismaGatewayGuardrailRepository extends GatewayGuardrailRepository {
  static create(database: PrismaClient): PrismaGatewayGuardrailRepository {
    return new PrismaGatewayGuardrailRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  async list(projectId: string): Promise<GatewayGuardrailResource[]> {
    const rows = await this.database.gatewayGuardrail.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ direction: "asc" }, { name: "asc" }],
    });
    return rows.map(toResource);
  }

  async listBundleEntries(projectId: string): Promise<GatewayGuardrailBundleEntry[]> {
    const rows = await this.database.gatewayGuardrail.findMany({
      where: { projectId, archivedAt: null },
      include: { evaluator: { select: { slug: true } } },
      orderBy: [{ direction: "asc" }, { name: "asc" }],
    });
    return rows.map((row) =>
      gatewayGuardrailBundleEntrySchema.parse({
        id: row.id,
        name: row.name,
        evaluatorId: row.evaluatorId,
        evaluatorSlug: row.evaluator?.slug ?? null,
        direction:
          row.direction === "PRE" ? "pre" : row.direction === "POST" ? "post" : "stream_chunk",
        failureMode: row.failureMode === "FAIL_OPEN" ? "fail_open" : "fail_closed",
      }),
    );
  }

  async tryGet({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null> {
    const row = await this.database.gatewayGuardrail.findFirst({
      where: { id, projectId, archivedAt: null },
    });
    return row ? toResource(row) : null;
  }

  async create(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    const row = await this.database.gatewayGuardrail.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        evaluatorId: input.evaluatorId,
        direction: input.direction,
        failureMode: input.failureMode ?? "FAIL_CLOSED",
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      },
    });
    return toResource(row);
  }

  async update(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    const row = await this.database.gatewayGuardrail.update({
      where: { id: input.id },
      data: {
        name: input.name,
        description: input.description,
        evaluatorId: input.evaluatorId,
        direction: input.direction,
        failureMode: input.failureMode,
        updatedById: input.actorUserId,
      },
    });
    return toResource(row);
  }

  async archive(input: ArchiveGatewayGuardrailInput): Promise<void> {
    await this.database.gatewayGuardrail.update({
      where: { id: input.id },
      data: { archivedAt: new Date(), updatedById: input.actorUserId },
    });
  }
}

function toResource(row: GatewayGuardrail): GatewayGuardrailResource {
  return gatewayGuardrailResourceSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    evaluatorId: row.evaluatorId,
    direction: row.direction,
    failureMode: row.failureMode,
    createdById: row.createdById,
    updatedById: row.updatedById,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
