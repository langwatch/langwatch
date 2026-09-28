/**
 * SlackIntegration as migration 20260928120002_slack_integration deploys it:
 * the (organizationId, secretFingerprint) unique index the re-plan relies on,
 * plus the scope index and enums the code reads.
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
  }: {
    organizationId: string;
    fingerprint: string;
  }) =>
    prisma.slackIntegration.create({
      data: {
        name: "Table test",
        kind: SlackIntegrationKind.INCOMING_WEBHOOK,
        scopeType: SlackIntegrationScopeType.ORGANIZATION,
        scopeId: organizationId,
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

  it("refuses a second connection for one secret in one organization with a unique violation", async () => {
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

  it("accepts that secret in another organization and another secret in the same one", async () => {
    await store({ organizationId: firstOrganization, fingerprint: "fp-own" });
    await store({ organizationId: secondOrganization, fingerprint: "fp-own" });
    await store({ organizationId: firstOrganization, fingerprint: "fp-other" });

    const stored = await prisma.slackIntegration.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { organizationId: true, secretFingerprint: true },
    });
    expect(stored).toEqual(
      expect.arrayContaining([
        { organizationId: firstOrganization, secretFingerprint: "fp-own" },
        { organizationId: secondOrganization, secretFingerprint: "fp-own" },
        { organizationId: firstOrganization, secretFingerprint: "fp-other" },
      ]),
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
          /UNIQUE INDEX "SlackIntegration_organizationId_secretFingerprint_key" .*\("organizationId", "secretFingerprint"\)/,
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
