import { describe, expect, it, vi } from "vitest";
import { OrganizationSettingsSecretPort } from "../../../ports/organization.port";
import { PrismaOrganizationRepository } from "../prisma.organization.repository";

class TestSettingsSecrets extends OrganizationSettingsSecretPort {
  encrypt(value: string): string {
    return `encrypted:${value}`;
  }

  decrypt(value: string): string {
    return value.replace("encrypted:", "");
  }
}

describe("PrismaOrganizationRepository settings", () => {
  it("preserves partial-update semantics and encrypts S3 credentials", async () => {
    const update = vi.fn().mockResolvedValue(void 0);
    const repository = PrismaOrganizationRepository.create(
      { organization: { update } },
      new TestSettingsSecrets(),
    );

    await repository.updateSettings({
      organizationId: "organization",
      primaryIntent: null,
      supportContact: "  ",
      s3Endpoint: "https://storage.example.com",
      s3AccessKeyId: "access-key",
      s3SecretAccessKey: "secret-key",
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

  it("decrypts only readable S3 settings", async () => {
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
    const repository = PrismaOrganizationRepository.create(
      { organization: { findUnique } },
      new TestSettingsSecrets(),
    );

    await expect(repository.tryFindSettings("organization")).resolves.toMatchObject({
      s3Endpoint: "https://storage.example.com",
      s3AccessKeyId: "access-key",
      s3Bucket: "bucket",
    });
  });
});
