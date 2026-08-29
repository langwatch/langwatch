import { describe, expect, it, vi } from "vitest";
import { PrismaIngestionTemplateRepository } from "../prisma.ingestion-template.repository";

const NOW = new Date("2026-08-24T00:00:00.000Z");

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "template-1",
    slug: "internal_codex_abc123",
    sourceType: "internal_codex",
    displayName: "Internal Codex",
    description: null,
    iconAsset: null,
    credentialSchema: null,
    ottlRules: "",
    platformPublished: false,
    enabled: true,
    organizationId: "organization-1",
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdById: "user-1",
    updatedById: "user-1",
    ...overrides,
  };
}

/**
 * A transaction client whose two writes are recorded.
 *
 * The template row and its audit row are written in ONE transaction on
 * purpose: an audit trail that can be missing for a write that happened is not
 * an audit trail, and the only place that is decided is here.
 */
function transactionalPrisma(options: {
  template?: Record<string, unknown>;
  existing?: Record<string, unknown> | null;
} = {}) {
  const created = options.template ?? storedRow();
  const templateCreate = vi.fn(async () => created);
  const templateUpdate = vi.fn(async () => created);
  const auditCreate = vi.fn(async () => undefined);
  const findFirst = vi.fn(async () => options.existing ?? null);

  const transaction = {
    ingestionTemplate: {
      create: templateCreate,
      update: templateUpdate,
      findFirst,
    },
    auditLog: { create: auditCreate },
  };

  return {
    templateCreate,
    templateUpdate,
    auditCreate,
    findFirst,
    database: {
      ingestionTemplate: { findFirst },
      $transaction: async <T>(run: (client: typeof transaction) => Promise<T>) =>
        run(transaction),
    },
  };
}

describe("PrismaIngestionTemplateRepository", () => {
  it("maps persistence rows to the strict public contract", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "template-1",
        slug: "platform_template",
        sourceType: "otlp",
        displayName: "Platform template",
        description: null,
        iconAsset: null,
        credentialSchema: null,
        ottlRules: "",
        platformPublished: true,
        enabled: true,
        organizationId: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: null,
        updatedById: null,
      },
    ]);
    const repository = PrismaIngestionTemplateRepository.create({
      ingestionTemplate: { findMany },
    });

    const rows = await repository.listUserVisible("organization-1");

    expect(rows).toEqual([
      {
        id: "template-1",
        slug: "platform_template",
        sourceType: "otlp",
        displayName: "Platform template",
        description: null,
        iconAsset: null,
        credentialSchema: null,
        ottlRules: "",
        platformPublished: true,
        enabled: true,
        organizationId: null,
      },
    ]);
  });

  /**
   * Ported from
   * `platform/app/src/app/api/governance/__tests__/governance-rest-api.integration.test.ts`
   * and `governance-audit-surface.integration.test.ts`, which reached these two
   * facts through HTTP and real Postgres. The facts are this repository's — it
   * is the only place the audit row is composed — so they are proved here, over
   * a recorded transaction, rather than by a suite that needs a database.
   */
  describe("when an organization template is created", () => {
    it("writes the row and its audit entry in one transaction", async () => {
      const prisma = transactionalPrisma();
      const repository = PrismaIngestionTemplateRepository.create(prisma.database);

      await repository.createWithAudit({
        template: {
          organizationId: "organization-1",
          slug: "internal_codex_abc123",
          sourceType: "internal_codex",
          displayName: "Internal Codex",
          description: null,
          iconAsset: null,
          credentialSchema: null,
          ottlRules: "",
        },
        callerUserId: "user-1",
        surface: "hono",
      });

      expect(prisma.templateCreate).toHaveBeenCalledOnce();
      expect(prisma.auditCreate).toHaveBeenCalledOnce();
    });

    it("records which surface the write came from, and never publishes the row", async () => {
      const prisma = transactionalPrisma();
      const repository = PrismaIngestionTemplateRepository.create(prisma.database);

      await repository.createWithAudit({
        template: {
          organizationId: "organization-1",
          slug: "internal_codex_abc123",
          sourceType: "internal_codex",
          displayName: "Internal Codex",
          description: null,
          iconAsset: null,
          credentialSchema: null,
          ottlRules: "",
        },
        callerUserId: "user-1",
        surface: "cli",
      });

      expect(prisma.auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          organizationId: "organization-1",
          action: "gateway.ingestion_template.created",
          targetKind: "ingestion_template",
          targetId: "template-1",
          metadata: expect.objectContaining({ surface: "cli" }),
        }),
      });
      expect(prisma.templateCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ platformPublished: false, enabled: true }),
      });
    });
  });

  describe("when an organization template is archived", () => {
    /**
     * Soft, not hard: the ingestion keys already handed out keep landing
     * traces, and the row simply stops being listed. `archivedAt` plus
     * `enabled: false` is what takes it out of both listings, whose `where`
     * clauses filter on exactly those two.
     */
    it("stamps the archival and takes the row out of the listings", async () => {
      const prisma = transactionalPrisma({ existing: storedRow() });
      const repository = PrismaIngestionTemplateRepository.create(prisma.database);
      const archivedAt = new Date("2026-08-25T00:00:00.000Z");

      const result = await repository.archiveWithAudit({
        id: "template-1",
        organizationId: "organization-1",
        callerUserId: "user-1",
        surface: "hono",
        archivedAt,
      });

      expect(result.status).toBe("updated");
      expect(prisma.templateUpdate).toHaveBeenCalledWith({
        where: { id: "template-1" },
        data: { archivedAt, enabled: false, updatedById: "user-1" },
      });
      expect(prisma.auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "gateway.ingestion_template.archived",
          metadata: expect.objectContaining({ surface: "hono" }),
        }),
      });
    });

    it("refuses a platform row and writes nothing", async () => {
      const prisma = transactionalPrisma({
        existing: storedRow({ organizationId: null, platformPublished: true }),
      });
      const repository = PrismaIngestionTemplateRepository.create(prisma.database);

      const result = await repository.archiveWithAudit({
        id: "template-1",
        organizationId: "organization-1",
        callerUserId: "user-1",
        surface: "hono",
        archivedAt: NOW,
      });

      expect(result.status).toBe("platform");
      expect(prisma.templateUpdate).not.toHaveBeenCalled();
      expect(prisma.auditCreate).not.toHaveBeenCalled();
    });

    it("reports a row this organization cannot reach as absent", async () => {
      const prisma = transactionalPrisma({ existing: null });
      const repository = PrismaIngestionTemplateRepository.create(prisma.database);

      const result = await repository.archiveWithAudit({
        id: "template-of-another-org",
        organizationId: "organization-1",
        callerUserId: "user-1",
        surface: "hono",
        archivedAt: NOW,
      });

      expect(result.status).toBe("not_found");
      expect(prisma.auditCreate).not.toHaveBeenCalled();
    });
  });
});
