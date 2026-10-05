import { describe, expect, it } from "vitest";

import { workflowVersionHistoryEntrySchema, workflowVersionSchema } from "../index.ts";

const VERSION = {
  id: "version_1",
  workflowId: "workflow_1",
  projectId: "project_1",
  version: "1",
  autoSaved: false,
  commitMessage: "first",
  authorId: null,
  parentId: null,
  dsl: { version: "1", name: "Flow", nodes: [], edges: [] },
};

describe("a workflow timestamp on the wire", () => {
  describe("given a version updated at a whole second", () => {
    it("serialises updatedAt with its three fractional digits", () => {
      const at = new Date("2026-01-01T00:00:05.000Z");
      const version = workflowVersionSchema.parse({ ...VERSION, createdAt: at, updatedAt: at });

      expect(JSON.parse(JSON.stringify(version))).toMatchObject({
        createdAt: "2026-01-01T00:00:05.000Z",
        updatedAt: "2026-01-01T00:00:05.000Z",
      });
    });
  });

  describe("given a version updated mid-second", () => {
    it("serialises updatedAt to the millisecond", () => {
      const at = new Date("2026-01-01T00:00:05.120Z");
      const version = workflowVersionSchema.parse({ ...VERSION, createdAt: at, updatedAt: at });

      expect(JSON.parse(JSON.stringify(version)).updatedAt).toBe("2026-01-01T00:00:05.120Z");
    });
  });

  describe("given a history entry", () => {
    it("serialises updatedAt with its three fractional digits", () => {
      const entry = workflowVersionHistoryEntrySchema.parse({
        id: "version_1",
        version: "1",
        autoSaved: false,
        commitMessage: "first",
        updatedAt: new Date("2026-01-01T00:00:05.000Z"),
        author: null,
      });

      expect(JSON.parse(JSON.stringify(entry)).updatedAt).toBe("2026-01-01T00:00:05.000Z");
    });
  });
});
