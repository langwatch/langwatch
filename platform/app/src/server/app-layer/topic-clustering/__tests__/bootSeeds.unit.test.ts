import { describe, expect, it, vi } from "vitest";

import { startTopicClusteringBootSeeds } from "../bootSeeds";

/**
 * The boot-seed wiring's contract with presets: one synchronous call fires
 * both seeds in the background and never lets a failure escape to the boot
 * path. The seed walks themselves are tested in seedTopicModel /
 * seedClusteringSchedules unit tests; here only the composition is real.
 *
 * Both seeds page the GLOBAL `Project` model (the tenancy guard exempts it),
 * so they are told apart by their where-clause: the topic-model seed keeps
 * projects that own Topic rows (`topics: { some }`), the schedule seed keeps
 * projects past their first message (`firstMessage: true`).
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

const pageWheres = (findMany: { mock: { calls: any[][] } }) =>
  findMany.mock.calls.map((call) => call[0]?.where);

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
        const wheres = pageWheres(prisma.project.findMany);
        // Topic-model seed pages the projects that own Topic rows…
        expect(wheres.some((where) => where?.topics)).toBe(true);
        // …and the schedule seed pages eligible projects.
        expect(wheres.some((where) => where?.firstMessage === true)).toBe(true);
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

      // Both seeds' page walk rejects; both rejections must be consumed
      // (no unhandled rejection escapes to the boot path).
      await vi.waitFor(() => {
        expect(prisma.project.findMany).toHaveBeenCalled();
      });
      await new Promise((resolve) => setImmediate(resolve));
    });
  });
});
