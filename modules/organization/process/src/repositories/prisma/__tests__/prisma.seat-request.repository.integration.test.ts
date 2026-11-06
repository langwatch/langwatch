/**
 * The seat request and access-notice tables against Postgres: one request row per address,
 * reused on reopen, and one notice per person, kind and day, each claimed for mail once.
 * @vitest-environment node
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaOrganizationAccessNoticeRepository } from "../prisma.organization-access-notice.repository.ts";
import { PrismaSeatRequestRepository } from "../prisma.seat-request.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("Prisma seat requests and access notices", () => {
  const namespace = `seat-requests-${nanoid(8)}`;
  const organizationId = `${namespace}-organization`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:seat-requests"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const requests = PrismaSeatRequestRepository.create(prisma);
  const notices = PrismaOrganizationAccessNoticeRepository.create(prisma);

  afterAll(async () => {
    await prisma.seatRequest.deleteMany({ where: { organizationId } });
    await prisma.organizationAccessNotice.deleteMany({ where: { organizationId } });
    await connection.closeOnce();
  });

  const open = (id: string, at: number) =>
    requests.open({
      id,
      organizationId,
      email: "late@acme.example",
      userId: null,
      name: null,
      source: "idp_refused",
      idpRefused: true,
      idpKind: "okta",
      at,
    });

  describe("when the same address opens, repeats, is declined and opens again", () => {
    it("keeps one row: opened, already open, then reopened with a fresh sales claim", async () => {
      const first = await open(`${namespace}-a`, 1_000);
      const repeat = await open(`${namespace}-b`, 2_000);

      expect(first.outcome).toBe("opened");
      expect(repeat).toMatchObject({ outcome: "already_open", request: { id: first.request.id } });
      expect(await requests.claimSalesNotice({ id: first.request.id, at: 2_500 })).toBe(true);
      expect(await requests.claimSalesNotice({ id: first.request.id, at: 2_600 })).toBe(false);

      expect(
        await requests.resolve({
          organizationId,
          id: first.request.id,
          status: "DECLINED",
          resolvedByUserId: "user-ada",
          at: 3_000,
        }),
      ).toBe(true);
      await expect(
        requests.getOpen({ organizationId, id: first.request.id }),
      ).rejects.toMatchObject({
        code: "seat_request_not_found",
      });

      const reopened = await open(`${namespace}-c`, 4_000);

      expect(reopened).toMatchObject({
        outcome: "reopened",
        request: { id: first.request.id, status: "OPEN", openedAt: 4_000, salesNotifiedAt: null },
      });
      expect((await requests.findOpen({ organizationId })).map((row) => row.id)).toEqual([
        first.request.id,
      ]);
    });
  });

  describe("when the same notice is recorded twice in a day and claimed twice", () => {
    it("stores one row and claims it for mail once", async () => {
      const record = (id: string) =>
        notices.record({
          id,
          organizationId,
          kind: "idp_refused",
          email: "late@acme.example",
          name: null,
          idp: "okta",
          idpRefused: true,
          dayKey: "2026-11-06",
          at: 10_000,
        });

      const [stored] = await record(`${namespace}-n1`);
      expect(await record(`${namespace}-n2`)).toEqual([]);
      expect(await notices.findOrganizationsWithHeld()).toContain(organizationId);

      expect(
        await notices.markMailed({ ids: [stored!.id], delivery: "digest", at: 20_000 }),
      ).toEqual([stored!.id]);
      expect(
        await notices.markMailed({ ids: [stored!.id], delivery: "digest", at: 20_001 }),
      ).toEqual([]);
      expect(await notices.getMailWindow({ organizationId })).toEqual({ lastMailedAt: 20_000 });
      expect(await notices.findHeld({ organizationId })).toEqual([]);
    });
  });
});
