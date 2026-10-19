import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  topicClusteringRunHistoryEntrySchema,
  topicClusteringRunHistoryPageInputSchema,
  topicClusteringRunHistoryPageSchema,
  topicClusteringStatusSchema,
  topicSchema,
} from "../index.ts";

describe("Topic contract", () => {
  it("validates the projected topic shape", () => {
    expect(
      topicSchema.parse({
        id: "topic-1",
        name: "Payments",
        parentId: null,
        automaticallyGenerated: true,
      }),
    ).toEqual({
      id: "topic-1",
      name: "Payments",
      parentId: null,
      automaticallyGenerated: true,
    });
  });

  it("rejects malformed read models", () => {
    expect(() => topicClusteringStatusSchema.parse({})).toThrow(ZodError);
    expect(() => topicClusteringRunHistoryEntrySchema.parse({})).toThrow(ZodError);
  });
});

describe("the run history page contract", () => {
  describe("given the page request", () => {
    it("asks for the first page of twenty when it names neither cursor nor limit", () => {
      expect(topicClusteringRunHistoryPageInputSchema.parse({ projectId: "project-1" })).toEqual({
        projectId: "project-1",
        limit: 20,
      });
    });

    it("carries the cursor and limit it names", () => {
      expect(
        topicClusteringRunHistoryPageInputSchema.parse({
          projectId: "project-1",
          cursor: "run-1",
          limit: 5,
        }),
      ).toEqual({ projectId: "project-1", cursor: "run-1", limit: 5 });
    });

    it.each([
      ["no project", {}],
      ["an empty project", { projectId: "" }],
      ["an empty cursor", { projectId: "project-1", cursor: "" }],
      ["a limit of zero", { projectId: "project-1", limit: 0 }],
      ["a limit past the retained fifty", { projectId: "project-1", limit: 51 }],
      ["a fractional limit", { projectId: "project-1", limit: 2.5 }],
    ])("refuses %s", (_name, input) => {
      expect(topicClusteringRunHistoryPageInputSchema.validate(input)).toBe(false);
    });
  });

  describe("given the page answer", () => {
    it("accepts a page and the expiry outcome", () => {
      expect(
        topicClusteringRunHistoryPageSchema.validate({
          outcome: "page",
          entries: [],
          hasMore: false,
          nextCursor: null,
        }),
      ).toBe(true);
      expect(topicClusteringRunHistoryPageSchema.validate({ outcome: "cursor_expired" })).toBe(
        true,
      );
    });

    it("refuses an outcome it does not declare", () => {
      expect(topicClusteringRunHistoryPageSchema.validate({ outcome: "restart" })).toBe(false);
    });
  });
});
