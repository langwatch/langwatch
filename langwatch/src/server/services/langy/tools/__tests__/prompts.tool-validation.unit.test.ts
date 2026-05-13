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
  makeGetPromptDetails,
  makeListPrompts,
  makeProposeCreatePrompt,
  makeProposeUpdatePrompt,
  makeSearchPrompts,
} from "../prompts";
import { ConversationToolIdSet } from "../../toolIdValidator";
import type { LangyConversationContext } from "../types";

function makeCtx(opts: {
  promptServiceLike?: Record<string, unknown>;
  seenIds?: ConversationToolIdSet;
} = {}): LangyConversationContext {
  return {
    projectId: "project-1",
    seenIds: opts.seenIds ?? new ConversationToolIdSet(),
    batchEvaluationService: {} as LangyConversationContext["batchEvaluationService"],
    datasetService: {} as LangyConversationContext["datasetService"],
    evaluatorService: {} as LangyConversationContext["evaluatorService"],
    experimentService: {} as LangyConversationContext["experimentService"],
    projectService: {} as LangyConversationContext["projectService"],
    promptService:
      (opts.promptServiceLike ??
        {}) as unknown as LangyConversationContext["promptService"],
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

describe("list_prompts tool-output validation", () => {
  describe("when promptService returns a row whose id is not a string", () => {
    it("returns the tool_output_invalid envelope", async () => {
      const promptServiceLike = {
        getAllPrompts: vi.fn().mockResolvedValueOnce([
          {
            id: 1,
            handle: "p-1",
            name: "Prompt 1",
            model: "openai/gpt-5-mini",
            scope: "project",
          },
        ]),
      };
      const toolDef = makeListPrompts(makeCtx({ promptServiceLike }));
      const result = await invokeTool(toolDef, {});

      expectInvalidEnvelope(result);
    });
  });

  describe("when promptService returns a well-formed row", () => {
    it("returns the parsed items array", async () => {
      const promptServiceLike = {
        getAllPrompts: vi.fn().mockResolvedValueOnce([
          {
            id: "p-1",
            handle: "p-1",
            name: "Prompt 1",
            model: "openai/gpt-5-mini",
            scope: "project",
          },
        ]),
      };
      const toolDef = makeListPrompts(makeCtx({ promptServiceLike }));
      const result = (await invokeTool(toolDef, {})) as {
        items: Array<{ id: string }>;
      };

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe("p-1");
    });
  });
});

describe("get_prompt_details tool-output validation", () => {
  describe("when the prompt is not found", () => {
    it("returns the error variant", async () => {
      const promptServiceLike = {
        getPromptByIdOrHandle: vi.fn().mockResolvedValueOnce(null),
      };
      const toolDef = makeGetPromptDetails(makeCtx({ promptServiceLike }));
      const result = (await invokeTool(toolDef, {
        idOrHandle: "missing",
      })) as { error?: string };

      expect(result.error).toContain("No prompt found");
    });
  });

  describe("when the prompt is found but its id field is non-string", () => {
    it("returns the tool_output_invalid envelope", async () => {
      const promptServiceLike = {
        getPromptByIdOrHandle: vi.fn().mockResolvedValueOnce({
          id: 42,
          handle: "p-1",
          scope: "project",
          model: "openai/gpt-5-mini",
        }),
      };
      const toolDef = makeGetPromptDetails(makeCtx({ promptServiceLike }));
      const result = await invokeTool(toolDef, { idOrHandle: "p-1" });

      expectInvalidEnvelope(result);
    });
  });
});

describe("search_prompts tool-output validation", () => {
  describe("when promptService.searchByKeyword returns rows whose handle is null", () => {
    it("returns the tool_output_invalid envelope", async () => {
      const promptServiceLike = {
        searchByKeyword: vi.fn().mockResolvedValueOnce([
          { id: "p-1", handle: null, name: "Prompt 1" },
        ]),
      };
      const toolDef = makeSearchPrompts(makeCtx({ promptServiceLike }));
      const result = await invokeTool(toolDef, { query: "x", limit: 5 });

      expectInvalidEnvelope(result);
    });
  });
});

describe("propose_create_prompt tool-output validation", () => {
  describe("when the proposal is well-formed", () => {
    it("returns the proposal envelope", async () => {
      const toolDef = makeProposeCreatePrompt(makeCtx());
      const result = (await invokeTool(toolDef, {
        handle: "rag-qa",
        messages: [{ role: "user", content: "Q" }],
        rationale: "fits",
      })) as { langyProposal: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.kind).toBe("prompts.create");
    });
  });
});

describe("propose_update_prompt tool-output validation", () => {
  describe("when the prompt id was not surfaced earlier", () => {
    it("returns the error variant", async () => {
      const toolDef = makeProposeUpdatePrompt(makeCtx());
      const result = (await invokeTool(toolDef, {
        id: "p-unsurfaced",
        commitMessage: "msg",
        rationale: "r",
      })) as { error?: string };

      expect(result.error).toContain("not surfaced");
    });
  });

  describe("when the prompt is surfaced and exists", () => {
    it("returns the proposal envelope", async () => {
      const seen = new ConversationToolIdSet();
      seen.record("prompt_id", "p-1");
      const promptServiceLike = {
        getPromptByIdOrHandle: vi.fn().mockResolvedValueOnce({
          id: "p-1",
          handle: "p-1",
        }),
      };
      const toolDef = makeProposeUpdatePrompt(
        makeCtx({ promptServiceLike, seenIds: seen }),
      );
      const result = (await invokeTool(toolDef, {
        id: "p-1",
        commitMessage: "tweak",
        rationale: "r",
      })) as { langyProposal: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.kind).toBe("prompts.update");
    });
  });
});
