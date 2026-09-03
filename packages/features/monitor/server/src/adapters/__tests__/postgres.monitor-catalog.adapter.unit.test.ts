import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { PostgresMonitorCatalogAdapter } from "../postgres.monitor-catalog.adapter";
import { PrismaMonitorRepository } from "../../repositories/prisma/prisma.monitor.repository";
import { MonitorService } from "../../services/monitor.service";

/**
 * Spec: packages/features/monitor/specs/monitor-catalog-seam.feature
 *
 * The listing the evaluation trigger reads once per trace. `MonitorService`
 * requires an `EvaluatorService` because creating and replicating a monitor
 * resolves the evaluator behind it; this read names no evaluator at all.
 */

function summaryRow() {
  return {
    id: "monitor-1",
    checkType: "langevals/basic",
    name: "Answer relevancy",
    threadIdleTimeout: null,
    evaluator: { name: "relevancy" },
  };
}

function database() {
  const findMany = vi.fn(async () => [summaryRow()]);
  return {
    client: { monitor: { findMany } } as unknown as PrismaClient,
    findMany,
  };
}

describe("PostgresMonitorCatalogAdapter", () => {
  describe("given a Prisma client and nothing else", () => {
    describe("when the catalogue is composed", () => {
      /** @scenario "The monitor catalogue composes from a database alone" */
      /** @scenario "Runtime reads are project scoped" */
      it("lists a project's enabled on-message monitors", async () => {
        const { client, findMany } = database();

        const catalogue = PostgresMonitorCatalogAdapter.create({ database: client }).build();

        await expect(catalogue.getEnabledOnMessageMonitors("project-1")).resolves.toEqual([
          summaryRow(),
        ]);
        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { projectId: "project-1", enabled: true, executionMode: "ON_MESSAGE" },
          }),
        );
      });
    });
  });

  describe("given the wide service composed over the same client", () => {
    describe("when both are asked for the same listing", () => {
      /** @scenario "The wide service and the catalogue answer from one implementation" */
      it("answers identically, because the wide service composes the narrow one", async () => {
        const narrow = database();
        const wide = database();

        const catalogue = PostgresMonitorCatalogAdapter.create({
          database: narrow.client,
        }).build();
        const service = MonitorService.create({
          repository: PrismaMonitorRepository.create(wide.client),
          evaluators: {} as never,
          generateId: () => "unused",
        });

        await expect(service.getEnabledOnMessageMonitors("project-1")).resolves.toEqual(
          await catalogue.getEnabledOnMessageMonitors("project-1"),
        );
        expect(wide.findMany.mock.calls[0]).toEqual(narrow.findMany.mock.calls[0]);
      });
    });
  });
});
