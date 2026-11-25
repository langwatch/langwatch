/**
 * @vitest-environment node
 * The ledger is read against the steps the image ships.
 * Spec: modules/ops/specs/upgrades-checkup.feature
 */
import { describe, expect, it, vi } from "vitest";

import { MemoryUpgradeLedgerRepository } from "../../memory/memory.upgrade-ledger.repository.ts";
import { PrismaUpgradeLedgerRepository } from "../prisma.upgrade-ledger.repository.ts";

const SHIPPED = {
  id: "prisma:29990101000000_shipped",
  kind: "postgres-schema",
  mode: "blocking",
};

describe("the ledger repositories over the image's steps", () => {
  describe("given the image ships a step the ledger has not recorded", () => {
    /** @scenario "A step the image ships that the ledger has not recorded keeps its migrations row refused, naming the step" */
    it("reads it from the Prisma ledger as an unrecorded, unsettled blocking step", async () => {
      const repository = PrismaUpgradeLedgerRepository.create({
        prisma: { $queryRawUnsafe: vi.fn().mockResolvedValue([]) },
        steps: [SHIPPED],
      });
      const page = await repository.findSteps({ mode: "blocking" });
      const step = page.items.find((item) => item.id === SHIPPED.id);
      expect(step).toMatchObject({ recorded: false, status: "pending" });
    });

    /** @scenario "A step the image ships that the ledger has not recorded keeps its migrations row refused, naming the step" */
    it("reads it from the memory twin the same way when a test passes the steps", async () => {
      const repository = MemoryUpgradeLedgerRepository.create({ steps: [SHIPPED] });
      const page = await repository.findSteps({ mode: "blocking" });
      expect(page.items.map((item) => item.id)).toEqual([SHIPPED.id]);
    });
  });

  describe("given the memory twin is handed no steps", () => {
    it("keeps an empty image", async () => {
      const page = await MemoryUpgradeLedgerRepository.create().findSteps();
      expect(page.items).toEqual([]);
    });
  });
});
