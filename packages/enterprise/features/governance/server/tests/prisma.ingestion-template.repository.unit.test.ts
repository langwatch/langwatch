import { describe, expect, it, vi } from "vitest";
import { PrismaIngestionTemplateRepository } from "../src/repositories/prisma/prisma.ingestion-template.repository";

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
});
