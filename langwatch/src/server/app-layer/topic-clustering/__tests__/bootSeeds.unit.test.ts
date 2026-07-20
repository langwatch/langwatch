import { describe, expect, it, vi } from "vitest";

import { startTopicClusteringBootSeeds } from "../bootSeeds";

/**
 * The boot-seed wiring's contract with presets: one synchronous call fires
 * both seeds in the background and never lets a failure escape to the boot
 * path. The seed walks themselves are tested in seedTopicModel /
 * seedClusteringSchedules unit tests; here only the composition is real.
 */

const emptyPrisma = () =>
  ({
    topic: { findMany: vi.fn().mockResolvedValue([]) },
    topicModelProjection: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    processManagerInstance: { findMany: vi.fn().mockResolvedValue([]) },
  }) as any;

const commands = () => ({
  recordTopics: vi.fn().mockResolvedValue(undefined),
  requestClustering: vi.fn().mockResolvedValue(undefined),
});

describe("startTopicClusteringBootSeeds", () => {
  describe("when a worker boots", () => {
    it("fires both seed walks in the background", async () => {
      const prisma = emptyPrisma();

      startTopicClusteringBootSeeds({
        prisma,
        redis: null,
        commands: commands(),
      });

      await vi.waitFor(() => {
        // Topic-model seed pages distinct projectIds off the Topic table…
        expect(prisma.topic.findMany).toHaveBeenCalled();
        // …and the schedule seed pages eligible projects.
        expect(prisma.project.findMany).toHaveBeenCalled();
      });
    });
  });

  describe("when every query rejects", () => {
    it("returns without throwing and surfaces nothing to the boot path", async () => {
      const prisma = {
        topic: { findMany: vi.fn().mockRejectedValue(new Error("pg down")) },
        topicModelProjection: {
          findMany: vi.fn().mockRejectedValue(new Error("pg down")),
        },
        project: { findMany: vi.fn().mockRejectedValue(new Error("pg down")) },
        processManagerInstance: {
          findMany: vi.fn().mockRejectedValue(new Error("pg down")),
        },
      } as any;

      expect(() =>
        startTopicClusteringBootSeeds({
          prisma,
          redis: null,
          commands: commands(),
        }),
      ).not.toThrow();

      // Both rejections must have been consumed (no unhandled rejection).
      await vi.waitFor(() => {
        expect(prisma.topic.findMany).toHaveBeenCalled();
        expect(prisma.project.findMany).toHaveBeenCalled();
      });
      await new Promise((resolve) => setImmediate(resolve));
    });
  });
});
