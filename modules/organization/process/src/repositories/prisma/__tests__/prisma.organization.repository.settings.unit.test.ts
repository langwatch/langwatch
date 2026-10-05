import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { aesEncryption } from "@langwatch/process-stores";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const HEX_KEY = randomBytes(32).toString("hex");
const cipher = aesEncryption(new Uint8Array(Buffer.from(HEX_KEY, "hex")));

/** main's platform/app/src/utils/encryption.ts `encrypt`, line for line: how rows were sealed. */
function mainEncrypt(text: string): string {
  const iv = randomBytes(12);
  const sealer = createCipheriv("aes-256-gcm", Buffer.from(HEX_KEY, "hex"), new Uint8Array(iv));
  let encrypted = sealer.update(text, "utf8", "hex");
  encrypted += sealer.final("hex");
  return `${iv.toString("hex")}:${encrypted}:${sealer.getAuthTag().toString("hex")}`;
}

/** main's `decrypt`, line for line: what an older image reads back. */
function mainDecrypt(sealed: string): string {
  const [ivHex = "", data = "", tagHex = ""] = sealed.split(":");
  const opener = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(HEX_KEY, "hex"),
    new Uint8Array(Buffer.from(ivHex, "hex")),
  );
  opener.setAuthTag(new Uint8Array(Buffer.from(tagHex, "hex")));
  return opener.update(data, "hex", "utf8") + opener.final("utf8");
}

describe("PrismaOrganizationRepository settings", () => {
  it("seals the S3 settings in main's format and keeps partial-update semantics", async () => {
    const update = vi.fn().mockResolvedValue(void 0);
    const repository = PrismaOrganizationRepository.create({
      database: prismaDouble({ organization: { update } }),
      cipher,
    });

    await repository.updateSettings({
      organizationId: "organization",
      primaryIntent: null,
      supportContact: "  ",
      s3Endpoint: "https://storage.example.com",
      s3AccessKeyId: "access-key",
      s3SecretAccessKey: "",
      s3Bucket: "",
    });

    const { where, data } = update.mock.calls[0]![0];
    expect(where).toEqual({ id: "organization" });
    expect(data).toMatchObject({
      primaryIntent: null,
      supportContact: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
    });
    expect(mainDecrypt(data.s3Endpoint)).toBe("https://storage.example.com");
    expect(mainDecrypt(data.s3AccessKeyId)).toBe("access-key");
  });

  it("opens a row main sealed", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "organization",
      name: "Acme",
      slug: "acme",
      supportContact: null,
      presenceEnabled: true,
      traceSharingEnabled: true,
      primaryIntent: null,
      s3Endpoint: mainEncrypt("https://storage.example.com"),
      s3AccessKeyId: mainEncrypt("access-key"),
      s3Bucket: "bucket",
      createdAt: new Date(1),
      updatedAt: new Date(2),
    });
    const repository = PrismaOrganizationRepository.create({
      database: prismaDouble({ organization: { findUnique } }),
      cipher,
    });

    await expect(repository.findStoredSettings("organization")).resolves.toMatchObject({
      s3Endpoint: "https://storage.example.com",
      s3AccessKeyId: "access-key",
      s3Bucket: "bucket",
    });
  });
});
