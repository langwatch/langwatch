/**
 * Queue and score work are one annotation seam, not separate feature packages.
 * See modules/annotation/specs/annotation-service.feature.
 */
import { readFileSync } from "node:fs";

import { AnnotationApi } from "@langwatch/annotation-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { annotationProcessModule } from "../../annotation.module.ts";
import {
  createAnnotationTestAuthz,
  createAnnotationTestEntitlement,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "./annotation.fixture.ts";

const catalogue: { features: { id: string; root: string; subjects: string[] }[] } = JSON.parse(
  readFileSync(new URL("../../../../../catalogue.json", import.meta.url), "utf8"),
);

describe("annotation queue and score seam", () => {
  describe("given a compatibility route manages queues or score definitions", () => {
    /** @scenario "queue transport orchestration remains one annotation seam" */
    it("reaches queue configuration, queue-item writes and scores through the one AnnotationApi", async () => {
      const traces = createAnnotationTestTraces();
      traces.findExistingTraceIds = async ({ traceIds }) => [...traceIds];

      const runtime = await createApp({ role: "api" })
        .withModules([withMemoryRepositories(annotationProcessModule)])
        .provide({
          project: createAnnotationTestProjects(),
          organization: createAnnotationTestOrganizations(["reviewer-1"]),
          trace: traces,
          user: createAnnotationTestUsers(),
          authz: createAnnotationTestAuthz(),
          entitlement: createAnnotationTestEntitlement(),
        })
        .boot();

      try {
        const app = runtime.service(AnnotationApi);
        const queue = await app.configure({
          projectId: "project-1",
          name: "Reviews",
          description: "",
          userIds: ["reviewer-1"],
          scoreTypeIds: [],
        });

        await expect(
          app.queueTraces({
            projectId: "project-1",
            traceIds: ["trace-1"],
            annotators: [`queue-${queue.id}`],
            userId: "reviewer-1",
          }),
        ).resolves.toEqual({ created: 1, skipped: 0 });

        await expect(app.listQueues({ projectId: "project-1" })).resolves.toEqual([
          expect.objectContaining({ id: queue.id }),
        ]);
        await expect(app.listQueueItems({ projectId: "project-1" })).resolves.toHaveLength(1);
        await expect(app.listScores({ projectId: "project-1" })).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "queue transport orchestration remains one annotation seam" */
    it("lists no queue or score feature package beside annotation", () => {
      const lookalikes = catalogue.features.filter(
        (feature) =>
          feature.id !== "annotation" &&
          /annotation-(queue|score)|^(queue|score)s?$/.test(`${feature.id} ${feature.root}`),
      );

      expect(lookalikes).toEqual([]);
      expect(catalogue.features.find((feature) => feature.id === "annotation")).toBeDefined();
    });
  });
});
