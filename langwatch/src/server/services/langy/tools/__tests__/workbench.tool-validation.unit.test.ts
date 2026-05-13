import { describe, expect, it, vi } from "vitest";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  LANGY_TOOL_OUTPUT_INVALID_CODE,
  langyToolErrorEnvelope,
} from "../../defineLangyTool";
import {
  makeFindFailingRows,
  makeGetWorkbenchState,
  makeProposeRunWorkbench,
} from "../workbench";
import { ConversationToolIdSet } from "../../toolIdValidator";
import type { LangyConversationContext } from "../types";

function makeCtx(opts: {
  experimentServiceLike?: Record<string, unknown>;
  evaluatorServiceLike?: Record<string, unknown>;
  experimentSlug?: string;
} = {}): LangyConversationContext {
  return {
    projectId: "project-1",
    experimentSlug: opts.experimentSlug,
    seenIds: new ConversationToolIdSet(),
    batchEvaluationService: {} as LangyConversationContext["batchEvaluationService"],
    datasetService: {} as LangyConversationContext["datasetService"],
    evaluatorService:
      (opts.evaluatorServiceLike ??
        {}) as unknown as LangyConversationContext["evaluatorService"],
    experimentService:
      (opts.experimentServiceLike ??
        {}) as unknown as LangyConversationContext["experimentService"],
    projectService: {} as LangyConversationContext["projectService"],
    promptService: {} as LangyConversationContext["promptService"],
  };
}

function invokeTool(toolDef: unknown, input: unknown): Promise<unknown> {
  const exec = (toolDef as { execute: (i: unknown) => Promise<unknown> })
    .execute;
  return exec(input);
}

function expectInvalidEnvelope(result: unknown) {
  expect(langyToolErrorEnvelope.safeParse(result).success).toBe(true);
  expect((result as { error: { code: string } }).error.code).toBe(
    LANGY_TOOL_OUTPUT_INVALID_CODE,
  );
}

describe("get_workbench_state tool-output validation", () => {
  describe("when no experiment slug is set on the context", () => {
    it("returns the error variant matching workbenchErrorSchema", async () => {
      const toolDef = makeGetWorkbenchState(makeCtx());
      const result = (await invokeTool(toolDef, {})) as { error?: string };

      expect(result.error).toContain("No experiment is currently open");
    });
  });

  describe("when the experiment has no saved workbench state", () => {
    it("returns the empty-state variant with experimentName + message", async () => {
      const experimentServiceLike = {
        findBySlug: vi.fn().mockResolvedValueOnce({
          name: "My Experiment",
          workbenchState: null,
        }),
      };
      const toolDef = makeGetWorkbenchState(
        makeCtx({ experimentServiceLike, experimentSlug: "exp-1" }),
      );
      const result = (await invokeTool(toolDef, {})) as {
        experimentName?: string;
        message?: string;
      };

      expect(result.experimentName).toBe("My Experiment");
      expect(result.message).toContain("no saved workbench state");
    });
  });

  describe("when the experiment record itself is shaped wrong", () => {
    it("returns the tool_output_invalid envelope", async () => {
      const experimentServiceLike = {
        findBySlug: vi.fn().mockResolvedValueOnce({
          name: 999,
          workbenchState: null,
        }),
      };
      const toolDef = makeGetWorkbenchState(
        makeCtx({ experimentServiceLike, experimentSlug: "exp-1" }),
      );
      const result = await invokeTool(toolDef, {});

      expectInvalidEnvelope(result);
    });
  });
});

describe("find_failing_rows tool-output validation", () => {
  describe("when no experiment is open", () => {
    it("returns the error variant", async () => {
      const toolDef = makeFindFailingRows(makeCtx());
      const result = (await invokeTool(toolDef, { limit: 5 })) as {
        error?: string;
      };

      expect(result.error).toContain("No experiment is currently open");
    });
  });

  describe("when the experiment has no workbench state", () => {
    it("returns the error variant", async () => {
      const experimentServiceLike = {
        findBySlug: vi.fn().mockResolvedValueOnce({ workbenchState: null }),
      };
      const toolDef = makeFindFailingRows(
        makeCtx({ experimentServiceLike, experimentSlug: "exp-1" }),
      );
      const result = (await invokeTool(toolDef, { limit: 5 })) as {
        error?: string;
      };

      expect(result.error).toContain("no results yet");
    });
  });
});

describe("propose_run_workbench tool-output validation", () => {
  describe("when the proposal is well-formed", () => {
    it("returns the proposal envelope", async () => {
      const toolDef = makeProposeRunWorkbench(makeCtx());
      const result = (await invokeTool(toolDef, {
        rationale: "ready to run",
      })) as { langyProposal: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.kind).toBe("workbench.run");
    });
  });
});
