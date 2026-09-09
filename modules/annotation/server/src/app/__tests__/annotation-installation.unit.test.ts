import {
  AnnotationApi,
  AnnotationNotFoundError,
  AnnotationQueueItemNotFoundError,
} from "@langwatch/annotation-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";
import { annotationServer } from "../../annotation.server.ts";
import { MemoryAnnotationRepository } from "../../repositories/memory/memory.annotation.repository.ts";
import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";
import {
  createAnnotationTestApp,
  createAnnotationTestAuthz,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "./annotation.fixture.ts";

function process() {
  return createApp({ name: "annotation-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(ProjectApi, createAnnotationTestProjects())
    .withProvided(OrganizationApi, createAnnotationTestOrganizations())
    .withProvided(TraceApi, createAnnotationTestTraces())
    .withProvided(UserApi, createAnnotationTestUsers())
    .withProvided(AuthzApi, createAnnotationTestAuthz())
    .withFeature(annotationServer);
}

const input = {
  projectId: "project-1",
  traceId: "trace-1",
  comment: "A review",
  isThumbsUp: true,
};

describe("annotation app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({ role });

    try {
      const app = runtime.service(AnnotationApi);
      const created = await app.createUnattributed(input);

      expect(runtime.feature(annotationServer).provided).toBe(app);

      await expect(
        app.getById({ projectId: input.projectId, id: created.id }),
      ).resolves.toMatchObject(input);

      await expect(
        app.getById({ projectId: "other-project", id: created.id }),
      ).rejects.toBeInstanceOf(AnnotationNotFoundError);

      await app.delete({ projectId: input.projectId, id: created.id });

      await expect(
        app.getById({ projectId: input.projectId, id: created.id }),
      ).rejects.toBeInstanceOf(AnnotationNotFoundError);
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process().boot({ role: "api" });
    const second = await process().boot({ role: "api" });

    try {
      const created = await first.service(AnnotationApi).createUnattributed(input);

      await expect(
        second.service(AnnotationApi).getById({ projectId: input.projectId, id: created.id }),
      ).rejects.toBeInstanceOf(AnnotationNotFoundError);

      await expect(
        first.service(AnnotationApi).list({ projectId: input.projectId, anchor: "all" }),
      ).resolves.toHaveLength(1);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  it("reads membership and scores from its peers and shared memory repositories", async () => {
    const members = [{ id: "reviewer-1", name: "Reviewer", image: "reviewer.png" }];
    const organizations = createAnnotationTestOrganizations(members);
    const traces = createAnnotationTestTraces();
    traces.findExistingTraceIds = async ({ traceIds }) => [...traceIds];
    const memory = MemoryAnnotationRepositories.create();
    const annotations = MemoryAnnotationRepository.create();

    const app = createAnnotationTestApp({
      repositories: { ...memory, annotations },
      dependencies: {
        projects: createAnnotationTestProjects(),
        organizations,
        traces,
        users: createAnnotationTestUsers(),
        permissions: createAnnotationTestAuthz(),
      },
    });

    await app.upsertScore({
      id: "score-correctness",
      projectId: "project-1",
      name: "Correctness",
      description: "Whether the answer is correct",
      dataType: "BOOLEAN",
      options: [],
      defaultValue: { value: null, options: null },
    });

    const queue = await app.configure({
      projectId: "project-1",
      name: "Review queue",
      description: "",
      userIds: ["reviewer-1"],
      scoreTypeIds: ["score-correctness"],
    });

    await expect(
      app.getQueue({ projectId: "project-1", queueId: queue.id }),
    ).resolves.toMatchObject({
      members: [{ user: { id: "reviewer-1", name: "Reviewer", image: "reviewer.png" } }],
      AnnotationQueueScores: [
        { annotationScore: { id: "score-correctness", name: "Correctness" } },
      ],
    });

    await app.queueTraces({
      projectId: "project-1",
      traceIds: ["shared-trace"],
      annotators: ["user-reviewer-1"],
      userId: "reviewer-1",
    });

    await app.queueTraces({
      projectId: "project-2",
      traceIds: ["shared-trace"],
      annotators: ["user-reviewer-1"],
      userId: "reviewer-1",
    });

    const projectOneItems = await app.listQueueItems({ projectId: "project-1" });
    const projectTwoItems = await app.listQueueItems({ projectId: "project-2" });
    const projectOneItem = projectOneItems[0];

    expect(projectOneItems).toHaveLength(1);
    expect(projectTwoItems).toHaveLength(1);
    expect(projectOneItem?.projectId).toBe("project-1");

    await expect(
      app.markQueueItemDone({
        projectId: "project-1",
        userId: "reviewer-1",
        queueItemId: projectOneItem!.id,
      }),
    ).resolves.toMatchObject({ id: projectOneItem!.id, doneAt: expect.any(Date) });

    const created = await app.create({
      id: "replacement-repository-annotation",
      projectId: "project-1",
      traceId: "shared-trace",
      userId: "reviewer-1",
      comment: "Saved through the replacement",
      isThumbsUp: null,
      scoreOptions: {},
      expectedOutput: null,
      anchorKind: null,
      anchorId: null,
      anchorPath: null,
    });

    await expect(
      annotations.getById({ projectId: "project-1", id: created.id }),
    ).resolves.toMatchObject({ comment: "Saved through the replacement" });

    members.splice(0, members.length);
    await expect(app.listQueueItems({ projectId: "project-1" })).resolves.toEqual([]);

    await expect(
      app.markQueueItemDone({
        projectId: "project-2",
        userId: "reviewer-1",
        queueItemId: projectTwoItems[0]!.id,
      }),
    ).rejects.toBeInstanceOf(AnnotationQueueItemNotFoundError);
  });

  it("treats an empty queue id as My Queue and a named id as that queue", async () => {
    const reviewerId = "reviewer-queue-page";
    const traces = createAnnotationTestTraces();
    traces.findExistingTraceIds = async ({ traceIds }) => [...traceIds];

    const app = createAnnotationTestApp({
      dependencies: {
        projects: createAnnotationTestProjects(),
        organizations: createAnnotationTestOrganizations([reviewerId]),
        traces,
        users: createAnnotationTestUsers(),
        permissions: createAnnotationTestAuthz(),
      },
    });

    await app.queueTraces({
      projectId: "project-1",
      traceIds: ["my-queue-trace"],
      annotators: [`user-${reviewerId}`],
      userId: reviewerId,
    });

    const queue = await app.configure({
      projectId: "project-1",
      name: "Named review queue",
      description: "",
      userIds: [reviewerId],
      scoreTypeIds: [],
    });

    await app.queueTraces({
      projectId: "project-1",
      traceIds: ["named-queue-trace"],
      annotators: [`queue-${queue.id}`],
      userId: reviewerId,
    });

    const myQueue = await app.listOptimizedQueues({
      projectId: "project-1",
      userId: reviewerId,
      selectedAnnotations: "pending",
      queueId: "",
      pageSize: 20,
      pageOffset: 0,
    });

    const namedQueue = await app.listOptimizedQueues({
      projectId: "project-1",
      userId: reviewerId,
      selectedAnnotations: "pending",
      queueId: queue.id,
      pageSize: 20,
      pageOffset: 0,
    });

    expect(myQueue.assignedQueueItems.map((item) => item.traceId)).toEqual(["my-queue-trace"]);

    expect(namedQueue.assignedQueueItems.map((item) => item.traceId)).toEqual([
      "named-queue-trace",
    ]);
  });
});
