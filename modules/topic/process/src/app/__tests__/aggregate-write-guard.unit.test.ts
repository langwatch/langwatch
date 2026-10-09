/**
 * Clustering writes topics under the project it names but is declared under `project:update`,
 * which the permission-level guard exempts, so the manual trigger asks the project itself
 * before any run is requested (ADR-175 decision 8).
 * @vitest-environment node
 */
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ResourceScope } from "@langwatch/process";
import { AggregateProjectIsReadOnlyError, type ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryTopicRepositories } from "../../repositories/memory/memory.topic.repositories.ts";
import { TopicModule } from "../topic.app.ts";

function appFor({ aggregate }: { aggregate: boolean }) {
  const projects = createApiFixture<ProjectApi>({
    assertAcceptsWrites: async () => {
      if (aggregate) throw new AggregateProjectIsReadOnlyError();
    },
  });
  const app = TopicModule.create({
    repositories: MemoryTopicRepositories.create({
      processStore: InMemoryProcessStore.createForTesting(),
    }),
    dependencies: {
      evaluations: createApiFixture<EvaluationApi>({}),
      traces: createApiFixture<TraceApi>({}),
      modelProviders: createApiFixture<ModelProviderApi>({}),
      projects,
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: {} as never,
  });
  const request = vi.spyOn(app, "requestClustering").mockResolvedValue(void 0);

  return { app, request };
}

describe("TopicModule.triggerTopicClustering", () => {
  describe("given an aggregate project", () => {
    it("refuses as read-only and requests no run", async () => {
      const { app, request } = appFor({ aggregate: true });

      await expect(
        app.triggerTopicClustering({ projectId: "project-1", by: { id: "user-1" } }),
      ).rejects.toMatchObject({ code: "aggregate_project_is_read_only" });
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe("given an ordinary project", () => {
    it("requests a run", async () => {
      const { app, request } = appFor({ aggregate: false });

      await expect(
        app.triggerTopicClustering({ projectId: "project-1", by: { id: "user-1" } }),
      ).resolves.toEqual({ started: true });
      expect(request).toHaveBeenCalledTimes(1);
    });
  });
});
