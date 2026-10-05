/**
 * SlackIntegration as migration 20260928120002_slack_integration deploys it:
 * the per-scope (organizationId, scopeType, scopeId, secretFingerprint) unique
 * index the re-plan relies on, plus the scope index and enums the code reads.
 */

import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import {
  Prisma,
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";

describe("SlackIntegration table", () => {
  const organizationIds = [`slacktab-${nanoid(8)}`, `slacktab-${nanoid(8)}`];
  const [firstOrganization = "", secondOrganization = ""] = organizationIds;

  const store = ({
    organizationId,
    fingerprint,
    projectId,
  }: {
    organizationId: string;
    fingerprint: string;
    projectId?: string;
  }) =>
    prisma.slackIntegration.create({
      data: {
        name: "Table test",
        kind: SlackIntegrationKind.INCOMING_WEBHOOK,
        scopeType: projectId
          ? SlackIntegrationScopeType.PROJECT
          : SlackIntegrationScopeType.ORGANIZATION,
        scopeId: projectId ?? organizationId,
        organizationId,
        webhookUrlEncrypted: "iv:ciphertext:tag",
        secretFingerprint: fingerprint,
        secretHint: "abcd",
        createdById: "user-1",
        updatedById: "user-1",
      },
    });

  afterAll(async () => {
    await prisma.slackIntegration.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
  });

  it("refuses a second connection for one secret in one scope with a unique violation", async () => {
    await store({
      organizationId: firstOrganization,
      fingerprint: "fp-shared",
    });

    const refused = await store({
      organizationId: firstOrganization,
      fingerprint: "fp-shared",
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(refused).toMatchObject({ code: "P2002" });
  });

  it("accepts that secret in another organization or scope, and another secret in the same scope", async () => {
    await store({ organizationId: firstOrganization, fingerprint: "fp-own" });
    await store({ organizationId: secondOrganization, fingerprint: "fp-own" });
    await store({ organizationId: firstOrganization, fingerprint: "fp-other" });
    for (const projectId of ["project-a", "project-b"]) {
      await store({
        organizationId: firstOrganization,
        fingerprint: "fp-own",
        projectId,
      });
    }

    const stored = await prisma.slackIntegration.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { organizationId: true, scopeId: true, secretFingerprint: true },
    });
    expect(stored).toEqual(
      expect.arrayContaining(
        [
          [firstOrganization, firstOrganization, "fp-own"],
          [secondOrganization, secondOrganization, "fp-own"],
          [firstOrganization, firstOrganization, "fp-other"],
          [firstOrganization, "project-a", "fp-own"],
          [firstOrganization, "project-b", "fp-own"],
        ].map(([organizationId, scopeId, secretFingerprint]) => ({
          organizationId,
          scopeId,
          secretFingerprint,
        })),
      ),
    );
  });

  it("deploys the scope index and the two enums the code reads", async () => {
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      -- @tenancy: reads the catalogue, not tenant rows
      SELECT indexdef FROM pg_indexes WHERE tablename = 'SlackIntegration'`;
    const labels = await prisma.$queryRaw<{ type: string; label: string }[]>`
      -- @tenancy: reads the catalogue, not tenant rows
      SELECT t.typname AS type, e.enumlabel AS label
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname IN ('SlackIntegrationKind', 'SlackIntegrationScopeType')
      ORDER BY t.typname, e.enumsortorder`;

    expect(indexes.map((index) => index.indexdef)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /UNIQUE INDEX "SlackIntegration_organizationId_scopeType_scopeId_secretFin_key" .*\("organizationId", "scopeType", "scopeId", "secretFingerprint"\)/,
        ),
        expect.stringMatching(
          /INDEX "SlackIntegration_scopeType_scopeId_idx" .*\("scopeType", "scopeId"\)/,
        ),
      ]),
    );
    expect(labels).toEqual([
      ...Object.values(SlackIntegrationKind).map((label) => ({
        type: "SlackIntegrationKind",
        label,
      })),
      ...Object.values(SlackIntegrationScopeType).map((label) => ({
        type: "SlackIntegrationScopeType",
        label,
      })),
    ]);
  });
});
