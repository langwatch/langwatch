// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/governance/governance-identity-and-erasure.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { fromDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaIdentityMatchRepository } from "../prisma.identity-match.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const connection = DB_URL
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:governance:test:identity-match-constraints"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }))
  : undefined;

describe.skipIf(!connection)("the identity-match table's own constraints", () => {
  const ns = `idmatch-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;

  const prisma = () => {
    if (!connection) throw new Error("no test database");
    return connection.client;
  };
  const repository = () => PrismaIdentityMatchRepository.create(prisma());
  const day = (offsetDays: number) => new Date(Date.UTC(2026, 0, 1 + offsetDays));
  const link = ({
    person,
    validFrom,
    validTo = null,
  }: {
    person: string;
    validFrom: Date;
    validTo?: Date | null;
  }) =>
    prisma().identityMatch.create({
      data: {
        organizationId: ORG_ID,
        discoveredPersonId: `${person}-${ns}`,
        userId: "user-1",
        evidenceKind: "human_confirmed",
        validFrom,
        validTo,
      },
    });

  afterAll(async () => {
    await prisma().identityMatch.deleteMany({ where: { organizationId: ORG_ID } });
  });

  describe("given a link whose start and end are the same instant", () => {
    /** @scenario "A link that covers no time at all is refused" */
    it("is refused by the database and nothing is stored", async () => {
      await expect(link({ person: "zero", validFrom: day(0), validTo: day(0) })).rejects.toThrow(
        /\S/,
      );

      expect(
        await prisma().identityMatch.count({
          where: { organizationId: ORG_ID, discoveredPersonId: `zero-${ns}` },
        }),
      ).toBe(0);
    });
  });

  describe("given a link whose end is earlier than its start", () => {
    /** @scenario "A link that ends before it starts is refused" */
    it("is refused by the database and nothing is stored", async () => {
      await expect(
        link({ person: "inverted", validFrom: day(5), validTo: day(2) }),
      ).rejects.toThrow(/\S/);

      expect(
        await prisma().identityMatch.count({
          where: { organizationId: ORG_ID, discoveredPersonId: `inverted-${ns}` },
        }),
      ).toBe(0);
    });
  });

  describe("given a person whose earlier link was closed when they left", () => {
    /** @scenario "A closed link and a new one for the same person can coexist" */
    it("keeps both when a new link opens after the old one closed", async () => {
      await link({ person: "returner", validFrom: day(0), validTo: day(10) });

      await repository().open({
        organizationId: ORG_ID,
        discoveredPersonId: `returner-${ns}`,
        userId: "user-2",
        evidenceKind: "human_confirmed",
        validFrom: fromDate(day(20)),
      });

      const kept = await repository().findAllByDiscoveredPerson({
        organizationId: ORG_ID,
        discoveredPersonId: `returner-${ns}`,
      });
      expect(kept.map((row) => row.validTo === null)).toEqual([false, true]);
    });
  });

  describe("given a provider-named person already linked to an account", () => {
    /** @scenario "A second open link is refused even when written straight to the database" */
    it("refuses a second open link written beside the repository, and keeps the first", async () => {
      await link({ person: "linked", validFrom: day(0) });

      await expect(link({ person: "linked", validFrom: day(3) })).rejects.toMatchObject({
        code: "P2002",
      });

      const rows = await prisma().identityMatch.findMany({
        where: { organizationId: ORG_ID, discoveredPersonId: `linked-${ns}` },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("given an erased person who had been linked to an account", () => {
    /** @scenario "The link's dates survive the erasure" */
    it("keeps the link with the dates it always had once the account reference is blanked", async () => {
      await link({ person: "erased", validFrom: day(0), validTo: day(30) });

      const blanked = await repository().blankUserReferences({
        organizationId: ORG_ID,
        discoveredPersonId: `erased-${ns}`,
      });

      const [row] = await repository().findAllByDiscoveredPerson({
        organizationId: ORG_ID,
        discoveredPersonId: `erased-${ns}`,
      });
      expect(blanked).toBe(1);
      expect(row?.userId).toBeNull();
      expect(row?.validFrom).toEqual(fromDate(day(0)));
      expect(row?.validTo).toEqual(fromDate(day(30)));
    });
  });
});
