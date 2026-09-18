/**
 * @vitest-environment node
 * The listing trace ingestion reads, and the one implementation behind it.
 * @see specs/monitor-catalog-seam.feature
 */
import type { MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { describe, expect, it } from "vitest";

import { createMonitorTestApp, createMonitorTestRepositories } from "../../app/__tests__/monitor.fixture.ts";
import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import { MonitorCatalogService } from "../monitor-catalog.service.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const onMessage: MonitorWithEvaluator = {
  id: "monitor-1",
  projectId: "project-1",
  experimentId: null,
  evaluatorId: "evaluator-1",
  checkType: "langevals/basic",
  name: "Answer relevancy",
  slug: "answer-relevancy",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [],
  parameters: {},
  mappings: { mapping: {}, expansions: [] },
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: NOW,
  updatedAt: NOW,
  evaluator: null,
};

function seeded() {
  const repository = MemoryMonitorRepository.create();
  repository.seed(onMessage);
  repository.seed({ ...onMessage, id: "monitor-2", name: "Manual", executionMode: "MANUALLY" });
  repository.seed({ ...onMessage, id: "monitor-3", name: "Other", projectId: "project-2" });

  return repository;
}

describe("given a monitor repository and no evaluator", () => {
  describe("when the catalogue is asked for a project's listing", () => {
    /** @scenario "The monitor catalogue answers from the monitor rows alone" */
    it("lists that project's enabled on-message monitors", async () => {
      const catalogue = MonitorCatalogService.create({ repository: seeded() });

      await expect(catalogue.getEnabledOnMessageMonitors("project-1")).resolves.toMatchObject([
        { id: "monitor-1", name: "Answer relevancy" },
      ]);
    });
  });
});

describe("given the monitor application and the catalogue over the same repository", () => {
  describe("when both are asked for the same project's listing", () => {
    /** @scenario "The application and the catalogue answer from one implementation" */
    it("answers identically", async () => {
      const repository = seeded();
      const catalogue = MonitorCatalogService.create({ repository });
      const app = createMonitorTestApp({
        repositories: createMonitorTestRepositories(repository),
      });

      await expect(app.getEnabledOnMessageMonitors("project-1")).resolves.toEqual(
        await catalogue.getEnabledOnMessageMonitors("project-1"),
      );
    });
  });
});
