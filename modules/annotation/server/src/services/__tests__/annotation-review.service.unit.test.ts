import { traceSchema } from "@langwatch/trace-contract";
import { userFullProfileSchema } from "@langwatch/user-contract";
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

const trace = traceSchema.parse({
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  input: { value: "input" },
  output: { value: "output" },
  spans: [],
});

function harness() {
  const traces = createAnnotationTestTraces();
  traces.loadTraces = vi.fn(async () => [trace]);
  traces.findExistingTraceIds = vi.fn(async () => ["trace-1"]);
  const users = createAnnotationTestUsers();

  users.getProfiles = vi.fn(async () => [
    userFullProfileSchema.parse({
      id: "user-1",
      name: "Reviewer",
      email: "reviewer@example.com",
      emailVerified: true,
      image: null,
      pendingSsoSetup: false,
      createdAt: new Date(1),
      updatedAt: new Date(1),
      lastLoginAt: null,
      deactivatedAt: null,
      lastHomePath: null,
      tracesExplorerTourDismissedAt: null,
    }),
  ]);

  const app = createAnnotationTestApp({
    repositories: MemoryAnnotationRepositories.create(),
    dependencies: {
      projects: createAnnotationTestProjects(),
      organizations: createAnnotationTestOrganizations(["user-1"]),
      traces,
      users,
      permissions: createAnnotationTestAuthz(),
    },
  });

  return { app, traces };
}

describe("AnnotationApp review reads", () => {
  it("hydrates a known annotation author and preserves a null author", async () => {
    const { app } = harness();

    await app.create({
      id: "a1",
      projectId: "project-1",
      traceId: "trace-1",
      userId: "user-1",
      comment: "one",
      isThumbsUp: null,
      scoreOptions: {},
      expectedOutput: null,
      anchorKind: null,
      anchorId: null,
      anchorPath: null,
    });

    await app.create({
      id: "a2",
      projectId: "project-1",
      traceId: "trace-1",
      userId: null,
      comment: "two",
      isThumbsUp: null,
      scoreOptions: {},
      expectedOutput: null,
      anchorKind: null,
      anchorId: null,
      anchorPath: null,
    });

    await expect(app.listWithFullUsers({ projectId: "project-1", anchor: "all" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a1", user: expect.objectContaining({ name: "Reviewer" }) }),
        expect.objectContaining({ id: "a2", user: null }),
      ]),
    );
  });

  it("loads each queue trace once and retains queue order", async () => {
    const { app, traces } = harness();

    await app.queueTraces({
      projectId: "project-1",
      traceIds: ["trace-1"],
      annotators: ["user-user-1"],
      userId: "user-1",
    });

    const result = await app.listReviewQueueItems({ projectId: "project-1", userId: "user-1" });

    expect(traces.loadTraces).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-1",
      traceIds: ["trace-1"],
    });

    expect(result[0]).toMatchObject({ trace });
  });
});
