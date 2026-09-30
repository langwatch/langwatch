/** Queue behaviour exercised through the composed annotation application. */
import {
  AnnotationQueueItemNotFoundError,
  AnnotationQueueMemberInvalidError,
  AnnotationQueueNameReservedError,
  AnnotationQueueNameTakenError,
} from "@langwatch/annotation-contract";
import { UserNotInOrganizationError } from "@langwatch/organization-contract";
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
  const findExistingTraceIds = vi.fn(async () => [...traceIds]);
  traces.findExistingTraceIds = findExistingTraceIds;
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

  return { app, findExistingTraceIds };
}

describe("AnnotationApp queue workflow", () => {
  /** @scenario "Queueing keeps only distinct traces held by the project" */
  it("queues each existing trace once when it is sent twice", async () => {
    const { app, findExistingTraceIds } = appWithExistingTraces(["trace-1"]);

    await expect(
      app.queueTraces({
        traceIds: ["trace-1", "trace-1"],
        projectId: "project-1",
        annotators: ["user-abc"],
        userId: "user-abc",
      }),
    ).resolves.toEqual({ created: 1, skipped: 1 });

    expect(findExistingTraceIds).toHaveBeenCalledWith({
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

  /** @scenario "A queue's slug is its slugified name, as the legacy product wrote it" */
  it("slugs an accented name with an ampersand the way slugify does", async () => {
    const { app } = appWithExistingTraces();

    await expect(
      app.configure({
        projectId: "project-1",
        name: "Café & Réview_Team",
        description: "d",
        userIds: [],
        scoreTypeIds: [],
      }),
    ).resolves.toMatchObject({ slug: "cafe-and-review-team" });
  });

  /** @scenario "Queueing keeps only distinct traces held by the project" */
  it("writes only distinct trimmed trace ids the project holds, and skips the rest", async () => {
    const { app, findExistingTraceIds } = appWithExistingTraces(["trace-1"]);

    await expect(
      app.queueTraces({
        traceIds: [" trace-1 ", "", "trace-1", "ghost", "  "],
        projectId: "project-1",
        annotators: ["user-abc"],
        userId: "abc",
      }),
    ).resolves.toEqual({ created: 1, skipped: 4 });

    expect(findExistingTraceIds).toHaveBeenCalledWith({
      projectId: "project-1",
      traceIds: ["trace-1", "ghost"],
    });

    const items = await app.listQueueItems({ projectId: "project-1" });
    expect(items.map((item) => item.traceId)).toEqual(["trace-1"]);
  });

  /** @scenario "Queue configuration validates references before reserved names" */
  it("rejects a member outside the organisation before the reserved name is looked at", async () => {
    const organizations = createAnnotationTestOrganizations(["user-1"]);
    organizations.getOrganizationMembers.mockRejectedValueOnce(
      new UserNotInOrganizationError("stranger"),
    );

    const app = createAnnotationTestApp({ dependencies: { organizations } });

    await expect(
      app.configure({
        projectId: "project-1",
        name: "All",
        description: "",
        userIds: ["stranger"],
        scoreTypeIds: [],
      }),
    ).rejects.toBeInstanceOf(AnnotationQueueMemberInvalidError);

    await expect(app.listQueues({ projectId: "project-1" })).resolves.toEqual([]);
  });

  /** @scenario "Completing an item derives the organisation from its project" */
  it("hands the repository the project's organisation and the reviewer when finishing an item", async () => {
    const repositories = MemoryAnnotationRepositories.create();
    const markQueueItemDone = vi.spyOn(repositories.queueItems, "markQueueItemDone");
    const projects = createAnnotationTestProjects("organization-9");

    const app = createAnnotationTestApp({
      repositories,
      dependencies: {
        projects,
        organizations: createAnnotationTestOrganizations(["user-1"]),
        traces: Object.assign(createAnnotationTestTraces(), {
          findExistingTraceIds: async () => ["trace-1"],
        }),
      },
    });

    await app.queueTraces({
      projectId: "project-1",
      traceIds: ["trace-1"],
      annotators: ["user-user-1"],
      userId: "user-1",
    });

    const [item] = await app.listQueueItems({ projectId: "project-1" });
    if (!item) throw new Error("queue item was not created");

    await app.markQueueItemDone({ projectId: "project-1", userId: "user-1", queueItemId: item.id });

    expect(projects.getOrganizationId).toHaveBeenCalledWith("project-1");
    expect(markQueueItemDone).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        organizationId: "organization-9",
        userId: "user-1",
        queueItemId: item.id,
      }),
    );

    await expect(
      app.markQueueItemDone({ projectId: "project-1", userId: "user-1", queueItemId: "missing" }),
    ).rejects.toBeInstanceOf(AnnotationQueueItemNotFoundError);
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
