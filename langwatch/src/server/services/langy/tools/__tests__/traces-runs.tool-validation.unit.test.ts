import { describe, expect, it, vi } from "vitest";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

vi.mock("~/server/elasticsearch", () => ({
  esClient: vi.fn(async () => ({ search: searchMock })),
  TRACE_INDEX: { alias: "trace_alias" },
}));

import {
  LANGY_TOOL_OUTPUT_INVALID_CODE,
  langyToolErrorEnvelope,
} from "../../defineLangyTool";
import { makeSearchPastRuns } from "../runs";
import { makeSearchTraces } from "../traces";
import { ConversationToolIdSet } from "../../toolIdValidator";
import type { LangyToolContext } from "../types";

function makeCtx(
  prismaLike: Record<string, unknown> = {},
): LangyToolContext {
  return {
    projectId: "project-1",
    seenIds: new ConversationToolIdSet(),
    evaluatorService: {} as LangyToolContext["evaluatorService"],
    promptService: {} as LangyToolContext["promptService"],
    prisma: prismaLike as unknown as LangyToolContext["prisma"],
  };
}

function invokeTool(toolDef: unknown, input: unknown): Promise<unknown> {
  const exec = (toolDef as { execute: (i: unknown) => Promise<unknown> })
    .execute;
  return exec(input);
}

describe("search_traces tool-output validation", () => {
  describe("when elasticsearch returns hits whose _id is not a string", () => {
    it("returns the tool_output_invalid envelope", async () => {
      searchMock.mockResolvedValueOnce({
        hits: { hits: [{ _id: 42, _source: {} }] },
      });
      const toolDef = makeSearchTraces(makeCtx());
      const result = await invokeTool(toolDef, { query: "x", limit: 5 });

      expect(langyToolErrorEnvelope.safeParse(result).success).toBe(true);
      expect((result as { error: { code: string } }).error.code).toBe(
        LANGY_TOOL_OUTPUT_INVALID_CODE,
      );
    });

    it("does not leak the malformed items array to the caller", async () => {
      searchMock.mockResolvedValueOnce({
        hits: { hits: [{ _id: 42, _source: {} }] },
      });
      const toolDef = makeSearchTraces(makeCtx());
      const result = await invokeTool(toolDef, { query: "x", limit: 5 });

      expect(result).not.toHaveProperty("items");
    });
  });

  describe("when elasticsearch returns well-formed hits", () => {
    it("returns the parsed items array", async () => {
      searchMock.mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _id: "trace-1",
              _source: {
                timestamps: { started_at: 1700000000 },
                input: { value: "hello world" },
              },
            },
          ],
        },
      });
      const toolDef = makeSearchTraces(makeCtx());
      const result = (await invokeTool(toolDef, {
        query: "x",
        limit: 5,
      })) as { items: Array<{ traceId: string }> };

      expect(result.items).toEqual([
        {
          traceId: "trace-1",
          startedAt: 1700000000,
          snippet: "hello world",
        },
      ]);
    });
  });
});

describe("search_past_runs tool-output validation", () => {
  describe("when prisma returns a row whose id is not a string", () => {
    it("returns the tool_output_invalid envelope", async () => {
      const prismaLike = {
        batchEvaluation: {
          findMany: vi.fn().mockResolvedValueOnce([
            {
              id: 123,
              experimentId: "exp-1",
              createdAt: new Date(),
              status: "complete",
              score: 1,
              passed: true,
              evaluation: "evaluation-name",
            },
          ]),
        },
      };
      const toolDef = makeSearchPastRuns(makeCtx(prismaLike));
      const result = await invokeTool(toolDef, { limit: 5 });

      expect(langyToolErrorEnvelope.safeParse(result).success).toBe(true);
      expect((result as { error: { code: string } }).error.code).toBe(
        LANGY_TOOL_OUTPUT_INVALID_CODE,
      );
    });

    it("does not leak the malformed rows to the caller", async () => {
      const prismaLike = {
        batchEvaluation: {
          findMany: vi.fn().mockResolvedValueOnce([
            {
              id: 123,
              experimentId: "exp-1",
              createdAt: new Date(),
              status: "complete",
              score: 1,
              passed: true,
              evaluation: "evaluation-name",
            },
          ]),
        },
      };
      const toolDef = makeSearchPastRuns(makeCtx(prismaLike));
      const result = await invokeTool(toolDef, { limit: 5 });

      expect(result).not.toHaveProperty("items");
    });
  });

  describe("when prisma returns well-formed rows", () => {
    it("returns the parsed items array", async () => {
      const createdAt = new Date("2026-05-13T00:00:00Z");
      const prismaLike = {
        batchEvaluation: {
          findMany: vi.fn().mockResolvedValueOnce([
            {
              id: "run-1",
              experimentId: "exp-1",
              createdAt,
              status: "complete",
              score: 0.8,
              passed: true,
              evaluation: "evaluation-name",
            },
          ]),
        },
      };
      const toolDef = makeSearchPastRuns(makeCtx(prismaLike));
      const result = (await invokeTool(toolDef, { limit: 5 })) as {
        items: Array<{ id: string }>;
      };

      expect(result.items).toEqual([
        {
          id: "run-1",
          experimentId: "exp-1",
          createdAt,
          status: "complete",
          score: 0.8,
          passed: true,
          evaluation: "evaluation-name",
        },
      ]);
    });
  });
});
