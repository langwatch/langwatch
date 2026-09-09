/** Queue behaviour exercised through the composed annotation application. */
import {
  AnnotationQueueNameReservedError,
  AnnotationQueueNameTakenError,
} from "@langwatch/annotation-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createAnnotationTestApp,
  createAnnotationTestAuthz,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "../../app/__tests__/annotation.fixture.ts";
import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";

function appWithExistingTraces(traceIds: readonly string[] = []) {
  const traces = createAnnotationTestTraces();
  traces.findExistingTraceIds = vi.fn(async () => [...traceIds]);
  const repositories = MemoryAnnotationRepositories.create();

  const app = createAnnotationTestApp({
    repositories,
    dependencies: {
      projects: createAnnotationTestProjects(),
      organizations: createAnnotationTestOrganizations(["user-1", "abc"]),
      traces,
      users: createAnnotationTestUsers(),
      permissions: createAnnotationTestAuthz(),
    },
  });

  return { app, traces };
}

describe("AnnotationApp queue workflow", () => {
  it("queues each existing trace once when it is sent twice", async () => {
    const { app, traces } = appWithExistingTraces(["trace-1"]);

    await expect(
      app.queueTraces({
        traceIds: ["trace-1", "trace-1"],
        projectId: "project-1",
        annotators: ["user-abc"],
        userId: "user-abc",
      }),
    ).resolves.toEqual({ created: 1, skipped: 1 });

    expect(traces.findExistingTraceIds).toHaveBeenCalledWith({
      projectId: "project-1",
      traceIds: ["trace-1"],
    });

    await expect(app.countAssignedItems({ projectId: "project-1", userId: "abc" })).resolves.toBe(
      1,
    );
  });

  it("rejects reserved and duplicate queue names", async () => {
    const { app } = appWithExistingTraces();

    const queue = {
      projectId: "project-1",
      name: "Team Reviews",
      description: "d",
      userIds: [],
      scoreTypeIds: [],
    };

    await expect(app.configure(queue)).resolves.toMatchObject({ slug: "team-reviews" });
    await expect(app.configure(queue)).rejects.toBeInstanceOf(AnnotationQueueNameTakenError);

    await expect(app.configure({ ...queue, name: "All" })).rejects.toBeInstanceOf(
      AnnotationQueueNameReservedError,
    );
  });

  it("only completes an item reachable by its requested project and user", async () => {
    const { app } = appWithExistingTraces(["trace-1"]);

    await app.queueTraces({
      projectId: "project-1",
      traceIds: ["trace-1"],
      annotators: ["user-user-1"],
      userId: "user-1",
    });

    const [item] = await app.listQueueItems({ projectId: "project-1" });
    if (!item) throw new Error("queue item was not created");

    await expect(
      app.markQueueItemDone({
        projectId: "project-1",
        userId: "user-1",
        queueItemId: item.id,
      }),
    ).resolves.toMatchObject({ id: item.id, doneAt: expect.any(Date) });
  });
});
