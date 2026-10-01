/**
 * The usage report's annotation figures, over the memory twins.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryAnnotationRepositories } from "../memory.annotation.repositories.ts";

const annotation = (id: string, projectId: string) => ({
  id,
  projectId,
  traceId: "trace_1",
  comment: "a note",
  isThumbsUp: null,
  scoreOptions: {},
  expectedOutput: null,
});

describe("given annotations across the install", () => {
  describe("when the usage report counts them", () => {
    it("counts only the named projects and dates the first", async () => {
      const repositories = MemoryAnnotationRepositories.create();
      const first = await repositories.annotations.create(annotation("a1", "p1"));
      await repositories.annotations.create(annotation("a2", "p1"));
      await repositories.annotations.create(annotation("a3", "other"));

      const counted = await repositories.usage.countUsage({ projectIds: ["p1"] });
      const later = await repositories.usage.countUsage({
        projectIds: ["p1"],
        since: Date.now() + 60_000,
      });

      expect(counted).toMatchObject({ annotations: 2, annotationQueues: 0 });
      expect(counted.firstAnnotationAt).toBe(first.createdAt.getTime());
      expect(later.annotations).toBe(0);
    });
  });
});
