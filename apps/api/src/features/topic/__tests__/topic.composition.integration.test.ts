/**
 * @vitest-environment node
 *
 * The topic module, installed the way the API process installs it. The trace
 * grid labels every row through `topics.getAll`, and the settings panel reads
 * the clustering status, so an install that mounts and cannot answer either
 * looks identical to a healthy one until a project opens the page.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { instantiateRepositories } from "@langwatch/runtime-composition";
import { topicRepositories } from "@langwatch/topic-server";
import { describe, expect, it, vi } from "vitest";
import { installApiTopic } from "../topic.composition.ts";

const PROJECT_ID = "project-1";

/** The tables the read surface touches, as a double. */
function testPrisma() {
  return {
    topic: {
      findMany: vi.fn(async () => [
        {
          id: "topic-1",
          name: "Payments",
          parentId: null,
          automaticallyGenerated: true,
        },
      ]),
    },
    topicClusteringRunProjection: { findUnique: vi.fn(async () => null) },
    topicClusteringRunHistoryProjection: { findUnique: vi.fn(async () => null) },
  } as unknown as PrismaClient;
}

async function installed() {
  return installApiTopic({ infrastructure: { prisma: testPrisma() } });
}

describe("given the topic module installed over the API process", () => {
  describe("when the trace grid asks for the project's topics", () => {
    it("answers with the rows the process's own connection holds", async () => {
      const feature = await installed();

      await expect(feature.app.getAll({ projectId: PROJECT_ID })).resolves.toEqual([
        { id: "topic-1", name: "Payments", parentId: null, automaticallyGenerated: true },
      ]);
    });
  });

  describe("when the settings panel asks for the clustering status", () => {
    it("answers that nothing is scheduled rather than refusing", async () => {
      const feature = await installed();

      const status = await feature.app.getClusteringStatus({ projectId: PROJECT_ID });

      expect(status.nextRunAt).toBeNull();
      expect(status.isInProgress).toBe(false);
    });
  });
});

describe("given the memory-backed topic repositories", () => {
  describe("when a process with no datastore selects them", () => {
    it("answers every read with the project's empty rows", async () => {
      const repositories = instantiateRepositories(topicRepositories, {
        backend: "memory",
        infrastructure: {},
      });

      await expect(repositories.topics.findAll({ projectId: PROJECT_ID })).resolves.toEqual([]);
      await expect(repositories.clustering.findProject(PROJECT_ID)).resolves.toBeNull();
    });
  });
});
