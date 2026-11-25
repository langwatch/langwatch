/** Spec: modules/evaluation/specs/evaluation-service.feature */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaEvaluationCostRepository } from "../prisma.evaluation-cost.repository.ts";

describe("given the Postgres evaluation cost ledger", () => {
  describe("when an evaluate call outside a trace records its cost", () => {
    /** @scenario "An evaluate call outside a trace still records its cost" */
    it("writes the entry without the absent trace id", async () => {
      const cost = { create: vi.fn().mockResolvedValue({}) };
      const repository = PrismaEvaluationCostRepository.create({
        prisma: prismaDouble({ cost }),
      });

      await repository.createEntry({
        id: "cost_1",
        projectId: "project-1",
        costType: "TRACE_CHECK",
        costName: "PF16 judge",
        referenceType: "CHECK",
        referenceId: "PF16 judge",
        amount: 0.001,
        currency: "USD",
        extraInfo: { trace_id: undefined },
      });

      expect(cost.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: "cost_1", extraInfo: {} }),
      });
    });
  });
});
