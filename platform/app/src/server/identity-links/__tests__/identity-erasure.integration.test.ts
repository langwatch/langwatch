/**
 * @vitest-environment node
 *
 * Erasure is the one irreversible path in ADR-094, and its unit tests run
 * against an in-memory Prisma stand-in that cannot see the real thing that
 * would stop it working: the organization-tenancy guard on the live client,
 * which refuses a query that names no organization. Every step here writes
 * through a guarded model.
 *
 * It also proves the property the whole design rests on — the token stored in
 * Postgres equals the one the report derives from the raw email ClickHouse
 * still holds (ADR-094 Constants, "Erased-email token") — against real column
 * types rather than a map in memory.
 *
 * ADR-094 Decision 9 / Invariants "Erasure is distinguishable and complete".
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrganizationUserRole } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { IdentityErasureTokenService } from "../erasure-token.service";
import { IdentityErasureService } from "../identity-erasure.service";
import { ERASED_SNAPSHOT_VALUE } from "../snapshot-erasure";

const ns = nanoid(8);
const SECRET = "f".repeat(64);
const ERASED_AT = new Date("2026-06-01T00:00:00Z");
const EFFECTIVE_FROM = new Date("2026-01-01T00:00:00Z");

// The provider's own spelling, which is what a raw ledger row still carries.
const RAW_EMAIL = `Erased.Person-${ns}@Example.com`;
const CANONICAL_EMAIL = RAW_EMAIL.toLowerCase();

let organizationId: string;
let connectionId: string;
let erasedUserId: string;
let colleagueUserId: string;
let agentWithPersonId: string;
let agentWithoutPersonId: string;

const service = () =>
  new IdentityErasureService(
    prisma,
    new IdentityErasureTokenService(SECRET),
    () => ERASED_AT,
  );

const linkByExternalId = async (externalId: string) =>
  await prisma.providerIdentityLink.findFirstOrThrow({
    where: { organizationId, externalId },
  });

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: "Erasure Org", slug: `--test-org-erasure-${ns}` },
  });
  organizationId = organization.id;

  const [erased, colleague] = await Promise.all([
    prisma.user.create({ data: { name: "Erased", email: RAW_EMAIL } }),
    prisma.user.create({
      data: { name: "Colleague", email: `colleague-${ns}@example.com` },
    }),
  ]);
  erasedUserId = erased.id;
  colleagueUserId = colleague.id;

  await prisma.organizationUser.createMany({
    data: [
      {
        userId: erasedUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
        externalId: `entra-${ns}`,
        scimSource: "azure-ad",
      },
      {
        userId: colleagueUserId,
        organizationId,
        role: OrganizationUserRole.ADMIN,
        externalId: `entra-colleague-${ns}`,
        scimSource: "azure-ad",
      },
    ],
  });

  const connection = await prisma.ingestionSource.create({
    data: {
      organizationId,
      sourceType: "claude_compliance",
      name: `Erasure Connection ${ns}`,
      ingestSecretHash: "unused-by-this-suite",
    },
  });
  connectionId = connection.id;

  const base = {
    organizationId,
    provider: "anthropic",
    providerConnectionId: connectionId,
    effectiveFrom: EFFECTIVE_FROM,
    source: "manual",
  };
  await prisma.providerIdentityLink.createMany({
    data: [
      // Their own typed login.
      {
        ...base,
        externalKind: "member_id",
        externalId: `mem-${ns}`,
        userId: erasedUserId,
        actorUserId: colleagueUserId,
      },
      // Their own email login — the one that gets tokenized.
      {
        ...base,
        externalKind: "email",
        externalId: CANONICAL_EMAIL,
        userId: erasedUserId,
        actorUserId: null,
      },
      // A row they AUTHORED as an admin for somebody else. This is the half an
      // erasure that only blanked `userId` would leave their name sitting in.
      {
        ...base,
        externalKind: "member_id",
        externalId: `mem-colleague-${ns}`,
        userId: colleagueUserId,
        actorUserId: erasedUserId,
      },
      // Nothing to do with them — the blast radius must stop before here.
      {
        ...base,
        externalKind: "member_id",
        externalId: `mem-unrelated-${ns}`,
        userId: colleagueUserId,
        actorUserId: colleagueUserId,
      },
    ],
  });

  const [withPerson, withoutPerson] = await Promise.all([
    prisma.discoveredAgent.create({
      data: {
        organizationId,
        providerConnectionId: connectionId,
        providerAgentKey: `env-1/bot-${ns}`,
        snapshot: {
          displayName: "Helper Bot",
          ownerEmail: RAW_EMAIL,
          ownerUserId: erasedUserId,
          quarantined: false,
        },
      },
    }),
    prisma.discoveredAgent.create({
      data: {
        organizationId,
        providerConnectionId: connectionId,
        providerAgentKey: `env-1/bot-other-${ns}`,
        snapshot: { displayName: "Other Bot", ownerEmail: "nobody@example.com" },
      },
    }),
  ]);
  agentWithPersonId = withPerson.id;
  agentWithoutPersonId = withoutPerson.id;
});

afterAll(() =>
  cleanupTestRows(prisma, [
    ["providerIdentityLink", { organizationId }],
    ["discoveredAgent", { organizationId }],
    ["ingestionSource", { organizationId }],
    ["organizationUser", { organizationId }],
    ["organization", { id: organizationId }],
    ["user", { id: { in: [erasedUserId, colleagueUserId] } } as never],
  ]),
);

describe("IdentityErasureService against a real database", () => {
  describe("given the dry run runs first", () => {
    it("counts what would go and leaves the database exactly as it was", async () => {
      const preview = await service().preview({
        organizationId,
        userId: erasedUserId,
      });

      expect(preview).toMatchObject({
        organizationId,
        userId: erasedUserId,
        // Two of their own plus the one they authored.
        linkRows: 3,
        directoryAnchors: 1,
        agentSnapshots: 1,
        emailLoginsTokenized: 1,
      });

      const untouched = await linkByExternalId(CANONICAL_EMAIL);
      expect(untouched.userId).toBe(erasedUserId);
      expect(untouched.erasedAt).toBeNull();
    });
  });

  describe("given a confirmed erasure of somebody who was also an admin actor", () => {
    it("blanks who they were everywhere, and keeps every row", async () => {
      const before = await prisma.providerIdentityLink.count({
        where: { organizationId },
      });

      const result = await service().erase({
        organizationId,
        userId: erasedUserId,
        confirm: true,
      });

      expect(result).toMatchObject({
        linkRows: 3,
        directoryAnchors: 1,
        agentSnapshots: 1,
        erasedAt: ERASED_AT,
      });

      // Decision 9's whole point: rows never disappear, so no superseded link
      // comes back into force and no published total moves.
      expect(
        await prisma.providerIdentityLink.count({ where: { organizationId } }),
      ).toBe(before);

      const own = await linkByExternalId(`mem-${ns}`);
      expect(own.userId).toBeNull();
      expect(own.erasedAt).toEqual(ERASED_AT);
      // The non-email id survives — a pseudonym whose key we no longer hold.
      expect(own.externalId).toBe(`mem-${ns}`);
      expect(own.actorUserId).toBe(colleagueUserId);

      const authored = await linkByExternalId(`mem-colleague-${ns}`);
      expect(authored.userId).toBe(colleagueUserId);
      expect(authored.actorUserId).toBeNull();
      expect(authored.erasedAt).toEqual(ERASED_AT);

      const unrelated = await linkByExternalId(`mem-unrelated-${ns}`);
      expect(unrelated.userId).toBe(colleagueUserId);
      expect(unrelated.actorUserId).toBe(colleagueUserId);
      expect(unrelated.erasedAt).toBeNull();
    });

    it("swaps the email login for the token the report re-derives from the raw ledger email", async () => {
      // The stored value, written by erasure.
      const [stored] = await prisma.providerIdentityLink.findMany({
        where: { organizationId, externalKind: "email" },
      });

      // What the report does at read time: take the raw email still sitting in
      // ClickHouse — provider casing and all — and derive the token. If these
      // differ, every erased person silently becomes "unattributed".
      const reportDerived = new IdentityErasureTokenService(SECRET).tokenFor({
        organizationId,
        email: RAW_EMAIL,
      });

      expect(stored!.externalId).toBe(reportDerived);
      expect(stored!.externalId).not.toContain("@");
      expect(stored!.erasedAt).toEqual(ERASED_AT);
    });

    it("blanks the directory anchor and leaves the colleague's alone", async () => {
      const [erasedMembership, colleagueMembership] = await Promise.all([
        prisma.organizationUser.findUniqueOrThrow({
          where: {
            userId_organizationId: { userId: erasedUserId, organizationId },
          },
        }),
        prisma.organizationUser.findUniqueOrThrow({
          where: {
            userId_organizationId: {
              userId: colleagueUserId,
              organizationId,
            },
          },
        }),
      ]);

      expect(erasedMembership.externalId).toBeNull();
      expect(erasedMembership.scimSource).toBeNull();
      expect(colleagueMembership.externalId).toBe(`entra-colleague-${ns}`);
    });

    it("blanks person references in the agent snapshot and stamps only the row it touched", async () => {
      const [touched, untouched] = await Promise.all([
        prisma.discoveredAgent.findUniqueOrThrow({
          where: { id: agentWithPersonId },
        }),
        prisma.discoveredAgent.findUniqueOrThrow({
          where: { id: agentWithoutPersonId },
        }),
      ]);

      expect(touched.snapshot).toEqual({
        displayName: "Helper Bot",
        ownerEmail: ERASED_SNAPSHOT_VALUE,
        ownerUserId: ERASED_SNAPSHOT_VALUE,
        quarantined: false,
      });
      expect(touched.erasedAt).toEqual(ERASED_AT);
      expect(untouched.erasedAt).toBeNull();
    });
  });

  describe("given a second erasure of the same person", () => {
    // Nothing names them any more, so the second pass finds nothing to do —
    // which is what stops it hashing the token the first pass wrote into a
    // second one the report could never re-derive.
    it("finds nothing left and leaves the token exactly as it was", async () => {
      const beforeToken = (
        await prisma.providerIdentityLink.findMany({
          where: { organizationId, externalKind: "email" },
        })
      )[0]!.externalId;

      await service().erase({
        organizationId,
        userId: erasedUserId,
        confirm: true,
      });

      const afterToken = (
        await prisma.providerIdentityLink.findMany({
          where: { organizationId, externalKind: "email" },
        })
      )[0]!.externalId;
      expect(afterToken).toBe(beforeToken);
    });
  });
});
