import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProcessOpsPrismaRepository } from "../prisma.process-ops.repository";

/**
 * The dead-letter reads, executed against a stubbed Prisma.
 * Spec: specs/ops/process-manager-visibility.feature
 */

const NOW = new Date("2026-08-17T09:00:00.000Z");

const deadRow = {
  id: "msg_1",
  processName: "triggerSettlement",
  projectId: "project_1",
  processKey: "trigger_abc",
  messageKey: "settle:trigger_abc:1",
  intentType: "lw.settle_trigger",
  status: "dead" as const,
  attempts: 7,
  nextAttemptAt: NOW,
  leasedUntil: null,
  createdAt: NOW,
  updatedAt: NOW,
  sourceEventId: "evt_1",
  traceCarrier: null,
  payload: { triggerId: "trigger_abc" },
};

/**
 * Answers each `$queryRaw` in call order, so a method issuing two queries in
 * one `Promise.all` gets the row page and the total in the order it asked.
 */
const repoAnswering = (results: unknown[]) => {
  const queryRaw = vi.fn();
  for (const result of results) queryRaw.mockResolvedValueOnce(result);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
  return { repo: ProcessOpsPrismaRepository.create({ prisma }), queryRaw };
};

describe("ProcessOpsPrismaRepository dead-letter reads", () => {
  describe("given the fleet holds a dead message", () => {
    describe("when findDeadMessages is called", () => {
      it("issues the queries and maps the rows it got back", async () => {
        const { repo, queryRaw } = repoAnswering([[deadRow], [{ total: 1 }]]);

        const result = await repo.findDeadMessages({ page: 1, pageSize: 25 });

        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(result.total).toBe(1);
        expect(result.messages).toEqual([
          {
            id: "msg_1",
            processName: "triggerSettlement",
            projectId: "project_1",
            processKey: "trigger_abc",
            messageKey: "settle:trigger_abc:1",
            intentType: "lw.settle_trigger",
            status: "dead",
            attempts: 7,
            nextAttemptAt: NOW.getTime(),
            leasedUntil: null,
            createdAt: NOW.getTime(),
            updatedAt: NOW.getTime(),
            sourceEventId: "evt_1",
            traceId: null,
            payload: { triggerId: "trigger_abc" },
          },
        ]);
      });

      it("passes the page's SQL the tenancy opt-out marker the guard requires", async () => {
        const { repo, queryRaw } = repoAnswering([[], [{ total: 0 }]]);

        await repo.findDeadMessages({ page: 1, pageSize: 25 });

        // `strings` is the Prisma.Sql fragment list; the marker sits in the
        // first chunk. Without it dbMultiTenancyProtection rejects the read,
        // which no amount of correct SQL would survive.
        const sql = queryRaw.mock.calls[0]![0] as { strings: string[] };
        expect(sql.strings.join(" ")).toContain("-- @tenancy:");
      });
    });

    describe("when a processName narrows the read", () => {
      it("still returns a mapped page rather than the filter fragment", async () => {
        const { repo } = repoAnswering([[deadRow], [{ total: 1 }]]);

        const result = await repo.findDeadMessages({
          processName: "triggerSettlement",
          page: 2,
          pageSize: 10,
        });

        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]?.processName).toBe("triggerSettlement");
      });
    });
  });

  describe("given the fleet holds no dead messages", () => {
    describe("when findDeadMessages is called", () => {
      it("reports an empty page instead of throwing", async () => {
        const { repo } = repoAnswering([[], []]);

        const result = await repo.findDeadMessages({ page: 1, pageSize: 25 });

        expect(result).toEqual({ messages: [], total: 0 });
      });
    });
  });

  describe("given dead messages spread across two processes", () => {
    describe("when countDeadByProcessName is called", () => {
      it("maps each group's total and oldest retirement", async () => {
        const { repo } = repoAnswering([
          [
            {
              processName: "triggerSettlement",
              count: 92,
              oldestUpdatedAt: NOW,
            },
            { processName: "webhookDelivery", count: 12, oldestUpdatedAt: NOW },
          ],
        ]);

        const counts = await repo.countDeadByProcessName();

        expect(counts).toEqual([
          {
            processName: "triggerSettlement",
            count: 92,
            oldestUpdatedAt: NOW.getTime(),
          },
          {
            processName: "webhookDelivery",
            count: 12,
            oldestUpdatedAt: NOW.getTime(),
          },
        ]);
      });
    });
  });
});
