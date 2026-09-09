import { describe, expect, it } from "vitest";
import { MemoryTopicRepository, type MemoryTopicProject } from "../memory.topic.repository.ts";

const PROJECT_ID = "project-1";

const topics = [
  { id: "topic-2", name: "Payments", parentId: "topic-root", automaticallyGenerated: true },
  { id: "topic-root", name: "Support", parentId: null, automaticallyGenerated: false },
];

function repository(project: Partial<MemoryTopicProject> = {}) {
  return MemoryTopicRepository.create(
    new Map([
      [
        PROJECT_ID,
        {
          topics: project.topics ?? topics,
          clusteringStatus: project.clusteringStatus ?? null,
          clusteringRunHistory: project.clusteringRunHistory ?? [],
        },
      ],
    ]),
  );
}

describe("MemoryTopicRepository", () => {
  /** @scenario "list topics for a project" */
  it("answers with the project's topics and nothing from another project", async () => {
    await expect(repository().findAll({ projectId: PROJECT_ID })).resolves.toEqual(topics);
    await expect(repository().findAll({ projectId: "project-2" })).resolves.toEqual([]);
  });

  /** @scenario "resolve names for trace facets" */
  it("names the topics the project holds and leaves unknown ids out", async () => {
    await expect(
      repository().findNamesByIds({ projectId: PROJECT_ID, ids: ["topic-2", "topic-absent"] }),
    ).resolves.toEqual(new Map([["topic-2", "Payments"]]));
  });

  it("does not answer a name lookup for an empty id list", async () => {
    await expect(repository().findNamesByIds({ projectId: PROJECT_ID, ids: [] })).resolves.toEqual(
      new Map(),
    );
  });

  describe("when the clustering projections have not been written", () => {
    /** @scenario "tolerate an unavailable history projection" */
    it("reads an absent status and an empty history", async () => {
      await expect(repository().findClusteringStatus({ projectId: PROJECT_ID })).resolves.toEqual({
        projection: null,
      });
      await expect(
        repository().findClusteringRunHistory({ projectId: PROJECT_ID }),
      ).resolves.toEqual([]);
    });
  });
});
