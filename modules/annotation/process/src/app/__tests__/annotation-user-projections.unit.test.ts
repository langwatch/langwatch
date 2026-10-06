/**
 * The users a transport result names are loaded once, and each read keeps its
 * legacy user shape. See modules/annotation/specs/annotation-service.feature.
 */
import { userFullProfileSchema } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createAnnotationTestApp,
  createAnnotationTestOrganizations,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "./annotation.fixture.ts";

const PROJECT_ID = "project-1";

function profile(id: string) {
  return userFullProfileSchema.parse({
    id,
    name: `Reviewer ${id}`,
    email: `${id}@example.com`,
    emailVerified: true,
    image: `https://example.com/${id}.png`,
    pendingSsoSetup: false,
    createdAt: new Date(1),
    updatedAt: new Date(1),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  });
}

async function harness() {
  const users = createAnnotationTestUsers();
  const getProfiles = vi.fn(async () => [profile("user-1"), profile("user-2")]);
  users.getProfiles = getProfiles;

  const traces = createAnnotationTestTraces();
  traces.findExistingTraceIds = async ({ traceIds }) => [...traceIds];

  const app = createAnnotationTestApp({
    dependencies: { organizations: createAnnotationTestOrganizations(["user-1"]), traces, users },
  });

  const base = { projectId: PROJECT_ID, isThumbsUp: null, scoreOptions: {}, expectedOutput: null };
  await app.create({ ...base, id: "a1", traceId: "trace-1", userId: "user-1", comment: "one" });
  await app.create({ ...base, id: "a2", traceId: "trace-1", userId: "user-2", comment: "two" });
  await app.create({ ...base, id: "a3", traceId: "trace-2", userId: "user-1", comment: "three" });

  return { app, getProfiles };
}

describe("annotation transport user projections", () => {
  describe("given an annotation result set that names users", () => {
    /** @scenario "transport user projections preserve their legacy shape" */
    it("loads each user once and keeps the full user on project reads", async () => {
      const { app, getProfiles } = await harness();

      const rows = await app.listWithFullUsers({ projectId: PROJECT_ID, anchor: "all" });

      expect(getProfiles).toHaveBeenCalledTimes(1);
      expect(getProfiles.mock.calls[0]).toEqual([{ userIds: ["user-1", "user-2"] }]);
      expect(rows.find((row) => row.id === "a2")?.user).toEqual(profile("user-2"));
    });

    /** @scenario "transport user projections preserve their legacy shape" */
    it("keeps the full user on queue reads", async () => {
      const { app, getProfiles } = await harness();

      await app.queueTraces({
        projectId: PROJECT_ID,
        traceIds: ["trace-1"],
        annotators: ["user-user-1"],
        userId: "user-1",
      });

      const page = await app.listOptimizedQueues({
        projectId: PROJECT_ID,
        userId: "user-1",
        selectedAnnotations: "pending",
        queueId: "",
        pageSize: 20,
        pageOffset: 0,
      });

      expect(getProfiles).toHaveBeenCalledTimes(1);
      expect(page.assignedQueueItems[0]?.annotations.find((row) => row.id === "a2")?.user).toEqual(
        profile("user-2"),
      );
    });

    /** @scenario "transport user projections preserve their legacy shape" */
    it("narrows trace reads to the user's id, name and image", async () => {
      const { app, getProfiles } = await harness();

      const rows = await app.listWithUserSummaries({
        projectId: PROJECT_ID,
        traceIds: ["trace-1"],
        anchor: "all",
      });

      expect(getProfiles).toHaveBeenCalledTimes(1);
      expect(rows.map((row) => row.user)).toEqual([
        { id: "user-1", name: "Reviewer user-1", image: "https://example.com/user-1.png" },
        { id: "user-2", name: "Reviewer user-2", image: "https://example.com/user-2.png" },
      ]);
    });
  });
});
