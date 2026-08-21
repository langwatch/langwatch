// @vitest-environment node
// ADR-094 Decision 8: our id is the reference, the provider's labels are the
// recognition rule, and the database — not a lookup — decides which row a
// re-seen agent is.
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import { beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import { DiscoveredAgentService } from "../discoveredAgent.service";

type Row = {
  id: string;
  organizationId: string;
  providerConnectionId: string;
  providerAgentKey: string;
  snapshot?: unknown;
};

/**
 * A stand-in that enforces the unique constraint the same way Postgres does —
 * by rejecting the insert — because the recognition rule under test IS that
 * rejection. A stand-in that let the duplicate through would test nothing.
 */
const createFakePrisma = () => {
  const rows: Row[] = [];
  let nextId = 1;
  const keyOf = (row: {
    organizationId: string;
    providerConnectionId: string;
    providerAgentKey: string;
  }) =>
    `${row.organizationId}|${row.providerConnectionId}|${row.providerAgentKey}`;

  return {
    rows,
    discoveredAgent: {
      create: ({ data }: { data: Row }) => {
        if (rows.some((row) => keyOf(row) === keyOf(data))) {
          return Promise.reject(
            new PrismaClientKnownRequestError("Unique constraint failed", {
              code: "P2002",
              clientVersion: "test",
            }),
          );
        }
        const row = { ...data, id: `agent-${nextId++}` };
        rows.push(row);
        return Promise.resolve({ id: row.id });
      },
      update: ({
        where,
        data,
      }: {
        where: {
          organizationId_providerConnectionId_providerAgentKey: {
            organizationId: string;
            providerConnectionId: string;
            providerAgentKey: string;
          };
        };
        data: { snapshot?: unknown };
      }) => {
        const target = keyOf(
          where.organizationId_providerConnectionId_providerAgentKey,
        );
        const row = rows.find((candidate) => keyOf(candidate) === target);
        if (!row) return Promise.reject(new Error("record not found"));
        if (data.snapshot !== undefined) row.snapshot = data.snapshot;
        return Promise.resolve({ id: row.id });
      },
    },
  };
};

const COPILOT_BOT = {
  organizationId: "org-a",
  providerConnectionId: "conn-a",
  // Copilot Studio bot ids are only unique inside an environment, so the
  // adapter joins both.
  providerAgentKey: "env-1/bot-9",
};

describe("DiscoveredAgentService", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let service: DiscoveredAgentService;

  beforeEach(() => {
    prisma = createFakePrisma();
    service = DiscoveredAgentService.create(prisma as unknown as PrismaClient);
  });

  describe("when an adapter reports the same agent on two pulls", () => {
    it("keeps one row, with a stable id", async () => {
      const first = await service.record({
        ...COPILOT_BOT,
        snapshot: { name: "Support Bot" },
      });
      const second = await service.record({
        ...COPILOT_BOT,
        snapshot: { name: "Support Bot" },
      });

      expect(second.id).toBe(first.id);
      expect(prisma.rows).toHaveLength(1);
    });
  });

  describe("when the agent is renamed at the provider", () => {
    it("stays the same row and takes the new snapshot", async () => {
      const first = await service.record({
        ...COPILOT_BOT,
        snapshot: { name: "Support Bot", quarantined: false },
      });

      const renamed = await service.record({
        ...COPILOT_BOT,
        snapshot: { name: "Customer Care", quarantined: true },
      });

      expect(renamed.id).toBe(first.id);
      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0]!.snapshot).toEqual({
        name: "Customer Care",
        quarantined: true,
      });
    });
  });

  describe("when the same provider labels appear under a different connection", () => {
    it("is a different agent — a bot id means nothing outside its connection", async () => {
      const first = await service.record(COPILOT_BOT);
      const other = await service.record({
        ...COPILOT_BOT,
        providerConnectionId: "conn-b",
      });

      expect(other.id).not.toBe(first.id);
      expect(prisma.rows).toHaveLength(2);
    });
  });

  describe("when the same provider labels appear in another organization", () => {
    it("is a different agent — inventory never crosses a tenant", async () => {
      await service.record(COPILOT_BOT);
      await service.record({ ...COPILOT_BOT, organizationId: "org-b" });

      expect(prisma.rows).toHaveLength(2);
    });
  });

  describe("when a pull carries no snapshot", () => {
    it("leaves the stored one alone rather than blanking it", async () => {
      await service.record({ ...COPILOT_BOT, snapshot: { name: "Kept" } });

      await service.record(COPILOT_BOT);

      expect(prisma.rows[0]!.snapshot).toEqual({ name: "Kept" });
    });
  });
});
