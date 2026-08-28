import {
  ingestionTemplateSchema,
  type GovernanceCallSurface,
  type IngestionTemplate,
  type PlatformIngestionTemplateSeed,
  type PlatformIngestionTemplateSyncResult,
} from "@langwatch/enterprise-governance-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import {
  IngestionTemplateRepository,
  type IngestionTemplateMutationResult,
  type NewIngestionTemplate,
} from "../../ports/ingestion-template.port";

type Client = Prisma.TransactionClient | PrismaClient;

export class PrismaIngestionTemplateRepository extends IngestionTemplateRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(database: object): PrismaIngestionTemplateRepository {
    return new PrismaIngestionTemplateRepository(database as PrismaClient);
  }

  async listUserVisible(organizationId: string): Promise<IngestionTemplate[]> {
    const rows = await this.prisma.ingestionTemplate.findMany({
      where: {
        archivedAt: null,
        enabled: true,
        OR: [{ organizationId: null }, { organizationId }],
      },
      orderBy: [{ platformPublished: "desc" }, { displayName: "asc" }],
    });
    return rows.map(toIngestionTemplate);
  }

  async listAdminVisible(organizationId: string): Promise<IngestionTemplate[]> {
    const rows = await this.prisma.ingestionTemplate.findMany({
      where: {
        archivedAt: null,
        OR: [{ organizationId: null }, { organizationId }],
      },
      orderBy: [{ platformPublished: "desc" }, { displayName: "asc" }],
    });
    return rows.map(toIngestionTemplate);
  }

  async tryFindVisible(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate | null> {
    const row = await this.prisma.ingestionTemplate.findFirst({
      where: {
        id: input.id,
        archivedAt: null,
        OR: [{ organizationId: null }, { organizationId: input.organizationId }],
      },
    });
    return row ? toIngestionTemplate(row) : null;
  }

  async tryFindPlatform(id: string): Promise<IngestionTemplate | null> {
    const row = await this.prisma.ingestionTemplate.findFirst({
      where: { id, organizationId: null, archivedAt: null },
    });
    return row ? toIngestionTemplate(row) : null;
  }

  createWithAudit(input: {
    template: NewIngestionTemplate;
    callerUserId: string;
    surface: GovernanceCallSurface;
  }): Promise<IngestionTemplate> {
    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.ingestionTemplate.create({
        data: {
          ...input.template,
          platformPublished: false,
          enabled: true,
          createdById: input.callerUserId,
          updatedById: input.callerUserId,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.callerUserId,
          organizationId: input.template.organizationId,
          action: "gateway.ingestion_template.created",
          targetKind: "ingestion_template",
          targetId: created.id,
          metadata: {
            slug: created.slug,
            sourceType: created.sourceType,
            displayName: created.displayName,
            surface: input.surface,
          },
        },
      });
      return toIngestionTemplate(created);
    });
  }

  updateOttlRulesWithAudit(input: {
    id: string;
    organizationId: string;
    callerUserId: string;
    ottlRules: string;
    surface: GovernanceCallSurface;
  }): Promise<IngestionTemplateMutationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await this.tryFindMutableCandidate(transaction, input);
      if (!existing) return { status: "not_found" };
      if (existing.organizationId === null) return { status: "platform" };

      const updated = await transaction.ingestionTemplate.update({
        where: { id: existing.id },
        data: {
          ottlRules: input.ottlRules,
          updatedById: input.callerUserId,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.callerUserId,
          organizationId: input.organizationId,
          action: "gateway.ingestion_template.ottl_updated",
          targetKind: "ingestion_template",
          targetId: existing.id,
          metadata: {
            slug: existing.slug,
            previousLineCount: countNonBlankLines(existing.ottlRules),
            nextLineCount: countNonBlankLines(input.ottlRules),
            surface: input.surface,
          },
        },
      });
      return {
        status: "updated",
        template: toIngestionTemplate(updated),
      };
    });
  }

  archiveWithAudit(input: {
    id: string;
    organizationId: string;
    callerUserId: string;
    surface: GovernanceCallSurface;
    archivedAt: Date;
  }): Promise<IngestionTemplateMutationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await this.tryFindMutableCandidate(transaction, input);
      if (!existing) return { status: "not_found" };
      if (existing.organizationId === null) return { status: "platform" };

      const updated = await transaction.ingestionTemplate.update({
        where: { id: existing.id },
        data: {
          archivedAt: input.archivedAt,
          enabled: false,
          updatedById: input.callerUserId,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.callerUserId,
          organizationId: input.organizationId,
          action: "gateway.ingestion_template.archived",
          targetKind: "ingestion_template",
          targetId: existing.id,
          metadata: { slug: existing.slug, surface: input.surface },
        },
      });
      return {
        status: "updated",
        template: toIngestionTemplate(updated),
      };
    });
  }

  syncPlatformCatalog(input: {
    templates: readonly PlatformIngestionTemplateSeed[];
    retiredSlugs: readonly string[];
    archivedAt: Date;
  }): Promise<PlatformIngestionTemplateSyncResult> {
    return this.prisma.$transaction(async (transaction) => {
      let created = 0;
      let updated = 0;
      let archived = 0;

      for (const template of input.templates) {
        const existing = await transaction.ingestionTemplate.findFirst({
          where: { organizationId: null, slug: template.slug },
          select: { id: true },
        });
        if (existing) {
          await transaction.ingestionTemplate.update({
            where: { id: existing.id },
            data: {
              ...template,
              platformPublished: true,
              enabled: true,
              archivedAt: null,
            },
          });
          updated += 1;
        } else {
          await transaction.ingestionTemplate.create({
            data: {
              ...template,
              organizationId: null,
              platformPublished: true,
              enabled: true,
            },
          });
          created += 1;
        }
      }

      for (const slug of input.retiredSlugs) {
        const result = await transaction.ingestionTemplate.updateMany({
          where: { organizationId: null, slug, archivedAt: null },
          data: { archivedAt: input.archivedAt, enabled: false },
        });
        archived += result.count;
      }
      return { created, updated, archived };
    });
  }

  private tryFindMutableCandidate(
    client: Client,
    input: { id: string; organizationId: string },
  ): Promise<{
    id: string;
    slug: string;
    organizationId: string | null;
    ottlRules: string;
  } | null> {
    return client.ingestionTemplate.findFirst({
      where: {
        id: input.id,
        archivedAt: null,
        OR: [{ organizationId: null }, { organizationId: input.organizationId }],
      },
      select: {
        id: true,
        slug: true,
        organizationId: true,
        ottlRules: true,
      },
    });
  }
}

function countNonBlankLines(value: string): number {
  return value.split("\n").filter((line) => line.trim().length > 0).length;
}

function toIngestionTemplate(row: {
  id: string;
  slug: string;
  sourceType: string;
  displayName: string;
  description: string | null;
  iconAsset: string | null;
  credentialSchema: string | null;
  ottlRules: string;
  platformPublished: boolean;
  enabled: boolean;
  organizationId: string | null;
}): IngestionTemplate {
  return ingestionTemplateSchema.parse({
    id: row.id,
    slug: row.slug,
    sourceType: row.sourceType,
    displayName: row.displayName,
    description: row.description,
    iconAsset: row.iconAsset,
    credentialSchema: row.credentialSchema,
    ottlRules: row.ottlRules,
    platformPublished: row.platformPublished,
    enabled: row.enabled,
    organizationId: row.organizationId,
  });
}
