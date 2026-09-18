import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

describe("PrismaOrganizationRepository settings", () => {
  it("preserves partial-update semantics and persists columns as given", async () => {
    const update = vi.fn().mockResolvedValue(void 0);
    const repository = PrismaOrganizationRepository.create({
      organization: { update },
    } as unknown as PrismaClient);

    // The service encrypts before calling this: the repository stores
    // exactly the strings it is handed, never deciding what they mean.
    await repository.updateSettings({
      organizationId: "organization",
      primaryIntent: null,
      supportContact: "  ",
      s3Endpoint: "encrypted:https://storage.example.com",
      s3AccessKeyId: "encrypted:access-key",
      s3SecretAccessKey: "encrypted:secret-key",
      s3Bucket: "",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "organization" },
      data: {
        primaryIntent: null,
        supportContact: null,
        s3Endpoint: "encrypted:https://storage.example.com",
        s3AccessKeyId: "encrypted:access-key",
        s3SecretAccessKey: "encrypted:secret-key",
        s3Bucket: null,
      },
    });
  });

  it("reads back the stored row without touching S3 settings", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "organization",
      name: "Acme",
      slug: "acme",
      supportContact: null,
      presenceEnabled: true,
      traceSharingEnabled: true,
      primaryIntent: null,
      s3Endpoint: "encrypted:https://storage.example.com",
      s3AccessKeyId: "encrypted:access-key",
      s3Bucket: "bucket",
      createdAt: new Date(1),
      updatedAt: new Date(2),
    });
    const repository = PrismaOrganizationRepository.create({
      organization: { findUnique },
    } as unknown as PrismaClient);

    await expect(repository.findStoredSettings("organization")).resolves.toMatchObject({
      s3Endpoint: "encrypted:https://storage.example.com",
      s3AccessKeyId: "encrypted:access-key",
      s3Bucket: "bucket",
    });
  });
});
