/** @vitest-environment node */
import { createCipheriv, randomBytes } from "node:crypto";

import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { aesEncryption } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository.ts";

const HEX_KEY = randomBytes(32).toString("hex");

/** main's platform/app/src/utils/encryption.ts `encrypt`, line for line: how rows were sealed. */
function mainEncrypt(text: string): string {
  const iv = randomBytes(12);
  const sealer = createCipheriv("aes-256-gcm", Buffer.from(HEX_KEY, "hex"), new Uint8Array(iv));
  let encrypted = sealer.update(text, "utf8", "hex");
  encrypted += sealer.final("hex");
  return `${iv.toString("hex")}:${encrypted}:${sealer.getAuthTag().toString("hex")}`;
}

const AT = new Date("2026-01-01T00:00:00.000Z");

/** One organization row with one team and one project, both storing main-sealed S3 settings. */
function storedOrganization() {
  return {
    id: "organization",
    name: "Acme",
    slug: "acme",
    createdAt: AT,
    updatedAt: AT,
    sentPlanLimitAlert: null,
    licenseExpiresAt: null,
    licenseLastValidatedAt: null,
    s3Endpoint: mainEncrypt("https://organization.example.com"),
    s3AccessKeyId: mainEncrypt("organization-key"),
    s3SecretAccessKey: mainEncrypt("organization-secret"),
    members: [],
    teams: [
      {
        id: "team",
        createdAt: AT,
        updatedAt: AT,
        archivedAt: null,
        members: [],
        projects: [
          {
            id: "project",
            createdAt: AT,
            updatedAt: AT,
            archivedAt: null,
            lastCodingAgentSessionAt: null,
            lastCodingAgentPullRequestAt: null,
            s3Endpoint: mainEncrypt("https://project.example.com"),
            s3AccessKeyId: mainEncrypt("project-key"),
            s3SecretAccessKey: null,
          },
        ],
      },
    ],
  };
}

describe("given an organization and a project whose S3 settings main sealed", () => {
  describe("when the organizations a person belongs to are read", () => {
    it("opens the endpoint and access key of both with the deployment's cipher", async () => {
      const findMany = vi.fn().mockResolvedValue([storedOrganization()]);
      const repository = PrismaOrganizationMembershipRepository.create({
        database: prismaDouble({ organization: { findMany } }),
        grants: createApiFixture<AuthzGrantsService>({}),
        cipher: aesEncryption(new Uint8Array(Buffer.from(HEX_KEY, "hex"))),
      });

      const [organization] = await repository.findAllForUser({
        userId: "user",
        isDemo: false,
        demoProjectUserId: "",
        demoProjectId: "",
      });

      expect(organization).toMatchObject({
        s3Endpoint: "https://organization.example.com",
        s3AccessKeyId: "organization-key",
      });
      expect(organization?.teams[0]?.projects[0]).toMatchObject({
        s3Endpoint: "https://project.example.com",
        s3AccessKeyId: "project-key",
        s3SecretAccessKey: null,
      });
    });
  });
});
