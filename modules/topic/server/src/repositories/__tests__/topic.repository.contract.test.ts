/**
 * @vitest-environment node
 * The contract every topic backend answers the same way, stated once and run
 * against each backend the package can reach. The memory tier runs it always;
 * a Postgres backend joins the table as a second row when this package
 * declares that datastore.
 */
import { describe, expect, it } from "vitest";
import { MemoryTopicRepositories } from "../memory/memory.topic.repositories.ts";
import type { TopicRepositories } from "../topic.repositories.ts";

const backends: ReadonlyArray<{ name: string; create: () => TopicRepositories }> = [
  { name: "memory", create: () => MemoryTopicRepositories.create() },
];

const PROJECT_ID = "project-1";

describe.each(backends)("given the $name topic backend", ({ create }) => {
  describe("when the clustering ledger is read back", () => {
    it("answers with nothing for a project no cost was recorded against", async () => {
      const repositories = create();

      await expect(repositories.clustering.findModelTopics(PROJECT_ID)).resolves.toEqual([]);
      await expect(repositories.clustering.findModelSubtopics(PROJECT_ID)).resolves.toEqual([]);
      await expect(repositories.clustering.findSeedTopicRows(PROJECT_ID)).resolves.toEqual([]);
    });

    it("records a clustering cost without answering it as a topic row", async () => {
      const repositories = create();

      await repositories.clustering.recordClusteringCost({
        projectId: PROJECT_ID,
        amount: 0.42,
        currency: "USD",
        tracesCount: 120,
        topicsCount: 8,
        subtopicsCount: 24,
        isIncremental: true,
      });

      await expect(repositories.clustering.findTopicIndexRows(PROJECT_ID)).resolves.toEqual([]);
    });
  });

  describe("when a project the module never saw is asked about", () => {
    it("answers that the project is absent rather than throwing", async () => {
      const repositories = create();

      await expect(repositories.clustering.findProject("project-absent")).resolves.toBeNull();
      await expect(
        repositories.clustering.findTopicModelCursor("project-absent"),
      ).resolves.toBeNull();
    });

    it("leaves an unknown project out of the owned and scheduled subsets", async () => {
      const repositories = create();

      await expect(
        repositories.clustering.findOwnedTopicModelProjectIds(["project-absent"]),
      ).resolves.toEqual([]);
      await expect(
        repositories.clustering.findAlreadyScheduledProjectIds(["project-absent"]),
      ).resolves.toEqual([]);
    });

    it("pages no projects when none hold topics or are eligible", async () => {
      const repositories = create();

      await expect(
        repositories.clustering.findProjectsWithTopicsPage({ afterId: null, take: 10 }),
      ).resolves.toEqual([]);
      await expect(
        repositories.clustering.findEligibleProjectsPage({ afterId: null, take: 10 }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the read surface is asked for a project with no rows", () => {
    it("answers with no topics, no names, no status and no run history", async () => {
      const repositories = create();

      await expect(repositories.topics.findAll({ projectId: PROJECT_ID })).resolves.toEqual([]);
      await expect(
        repositories.topics.findNamesByIds({ projectId: PROJECT_ID, ids: ["topic-1"] }),
      ).resolves.toEqual(new Map());
      await expect(repositories.topics.findClusteringStatus({ projectId: PROJECT_ID })).resolves
        .toEqual({ projection: null });
      await expect(
        repositories.topics.findClusteringRunHistory({ projectId: PROJECT_ID }),
      ).resolves.toEqual([]);
    });
  });
});
