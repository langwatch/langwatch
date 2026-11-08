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

  describe("when an open that only fills a gap meets a missing row and then an answered one", () => {
    /** @scenario "Arriving again never reopens a seat request that was answered" */
    it("opens the missing row, then leaves the declined row as it is", async () => {
      const gapOnly = (id: string, at: number) =>
        requests.open({
          id,
          organizationId,
          email: "again@acme.example",
          userId: null,
          name: null,
          source: "pending",
          idpRefused: false,
          idpKind: null,
          at,
          onlyIfAbsent: true,
        });
      const first = await gapOnly(`${namespace}-gap-a`, 1_000);
      await requests.resolve({
        organizationId,
        id: first.request.id,
        status: "DECLINED",
        resolvedByUserId: "user-ada",
        at: 2_000,
      });

      const again = await gapOnly(`${namespace}-gap-b`, 3_000);

      expect(first.outcome).toBe("opened");
      expect(again).toMatchObject({
        outcome: "already_recorded",
        request: { id: first.request.id, status: "DECLINED" },
      });
    });
  });

  describe("when a request is reopened, claimed and declined while another arrival is in flight", () => {
    /** @scenario "Sales hear about a seat request from an account-managed organization once" */
    it("leaves the newer decline and its sales claim in place", async () => {
      const email = "inflight@acme.example";
      const arrival = (repository: PrismaSeatRequestRepository, id: string, at: number) =>
        repository.open({
          id,
          organizationId,
          email,
          userId: null,
          name: null,
          source: "pending",
          idpRefused: false,
          idpKind: null,
          at,
        });
      const decline = (id: string, at: number) =>
        requests.resolve({ organizationId, id, status: "DECLINED", resolvedByUserId: "u", at });
      const { request } = await arrival(requests, `${namespace}-f1`, 60_000);
      await decline(request.id, 61_000);

      let interleave = async () => {};
      const stalledRequests = new Proxy(prisma.seatRequest, {
        get(target, property) {
          if (property !== "findUnique") return Reflect.get(target, property);
          return async (args: Parameters<typeof target.findUnique>[0]) => {
            const row = await target.findUnique(args);
            await interleave();
            return row;
          };
        },
      });
      const stalledPrisma = new Proxy(prisma, {
        get(target, property) {
          if (property === "seatRequest") return stalledRequests;
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      interleave = async () => {
        interleave = async () => {};
        expect((await arrival(requests, `${namespace}-f2`, 62_000)).outcome).toBe("reopened");
        expect(await requests.claimSalesNotice({ id: request.id, at: 62_500 })).toBe(true);
        expect(await decline(request.id, 63_000)).toBe(true);
      };

      const late = await arrival(
        PrismaSeatRequestRepository.create(stalledPrisma),
        `${namespace}-f3`,
        62_100,
      );

      expect(late.outcome).toBe("resolved_meanwhile");
      expect(late.request).toMatchObject({
        status: "DECLINED",
        resolvedAt: 63_000,
        salesNotifiedAt: 62_500,
      });
    });
  });

  describe("when callers race to resolve a request, claim its sales notice or claim a notice", () => {
    /** @scenario "Sales hear about a seat request from an account-managed organization once" */
    it("lets exactly one of them win each claim", async () => {
      const email = "racer@acme.example";
      const { request } = await requests.open({
        id: `${namespace}-r1`,
        organizationId,
        email,
        userId: null,
        name: null,
        source: "pending",
        idpRefused: false,
        idpKind: null,
        at: 50_000,
      });
      const [notice] = await notices.record({
        id: `${namespace}-rn`,
        organizationId,
        kind: "seat_request",
        email,
        name: null,
        idp: null,
        idpRefused: false,
        dayKey: "2026-11-08",
        at: 50_000,
      });

      const sales = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          requests.claimSalesNotice({ id: request.id, at: 51_000 + index }),
        ),
      );
      const mailed = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          notices.markMailed({ ids: [notice!.id], at: 52_000 + index }),
        ),
      );
      const resolved = await Promise.all(
        (["APPROVED", "DECLINED", "DECLINED"] as const).map((status, index) =>
          requests.resolve({
            organizationId,
            id: request.id,
            status,
            resolvedByUserId: `user-${index}`,
            at: 53_000 + index,
          }),
        ),
      );

      expect(sales.filter(Boolean)).toHaveLength(1);
      expect(mailed.filter((ids) => ids.length > 0)).toHaveLength(1);
      expect(resolved.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("when approvals claim requests and only one of them gives its seat", () => {
    /** @scenario "An approval whose seat never landed is reopened" */
    it("finds only the old unsettled approval and reopens it", async () => {
      const pendingOrganizationId = `${namespace}-pending`;
      const approve = async (email: string, at: number) => {
        const { request } = await requests.open({
          id: `${namespace}-${email}`,
          organizationId: pendingOrganizationId,
          email,
          userId: null,
          name: null,
          source: "pending",
          idpRefused: false,
          idpKind: null,
          at: at - 100,
        });
        await requests.resolve({
          organizationId: pendingOrganizationId,
          id: request.id,
          status: "APPROVED",
          resolvedByUserId: "user-ada",
          at,
        });
        return request.id;
      };
      try {
        const stranded = await approve("stranded@acme.example", 10_000);
        const settled = await approve("settled@acme.example", 11_000);
        await approve("fresh@acme.example", 50_000);
        await requests.settleSeat({
          organizationId: pendingOrganizationId,
          id: settled,
          at: 11_000,
        });

        const pending = await requests.findSeatPending({
          organizationId: pendingOrganizationId,
          since: 40_000,
        });
        expect(pending.map((row) => row.id)).toEqual([stranded]);

        await requests.release({
          organizationId: pendingOrganizationId,
          id: stranded,
          resolvedByUserId: "user-ada",
          at: 10_000,
        });
        const reopened = await requests.getOpen({
          organizationId: pendingOrganizationId,
          id: stranded,
        });
        expect(reopened.status).toBe("OPEN");
        expect(
          await requests.findSeatPending({ organizationId: pendingOrganizationId, since: 40_000 }),
        ).toEqual([]);
      } finally {
        await prisma.seatRequest.deleteMany({ where: { organizationId: pendingOrganizationId } });
      }
    });
  });

  describe("when the same notice is recorded twice in a day and claimed twice", () => {
    /** @scenario "A notice whose mail reached nobody is retried by the next arrival that day" */
    it("stores one row, hands it back while unmailed and claims it for mail once", async () => {
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
      expect((await record(`${namespace}-n2`)).map((row) => row.id)).toEqual([stored!.id]);

      expect(await notices.markMailed({ ids: [stored!.id], at: 20_000 })).toEqual([stored!.id]);
      expect(await notices.markMailed({ ids: [stored!.id], at: 20_001 })).toEqual([]);
      expect(await record(`${namespace}-n3`)).toEqual([]);

      await notices.releaseMailed({ id: stored!.id });
      expect((await record(`${namespace}-n4`)).map((row) => row.id)).toEqual([stored!.id]);
      expect(await notices.countRefusedForDay({ organizationId, dayKey: "2026-11-06" })).toBe(1);
      expect(await notices.countRefusedForDay({ organizationId, dayKey: "2026-11-07" })).toBe(0);
    });
  });
});
