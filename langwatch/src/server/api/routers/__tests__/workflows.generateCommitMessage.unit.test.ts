import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { blankTemplate } from "../../../../optimization_studio/templates/blank";
import { createInnerTRPCContext } from "../../trpc";
import { workflowRouter } from "../workflows";

// Regression: commit-message autogen sent function tools + reasoning_effort
// to /v1/chat/completions, which the gpt-5 family rejects ("use /v1/responses
// instead"). A commit message is one short string, so generation must be a
// plain-text completion with no function-tool round-trip.

const mockGetVercelAIModel = vi.fn();
vi.mock("../../../modelProviders/utils", () => ({
  getVercelAIModel: (...args: unknown[]) => mockGetVercelAIModel(...args),
}));

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

type MiddlewareParams = {
  ctx: Record<string, unknown>;
  next: () => Promise<unknown>;
};

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    checkProjectPermission:
      () =>
      async ({ ctx, next }: MiddlewareParams) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

describe("workflowRouter.generateCommitMessage()", () => {
  let caller: ReturnType<typeof workflowRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();

    const ctx = createInnerTRPCContext({
      session: { user: { id: "test-user-id" }, expires: "1" },
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: false,
    });
    ctx.prisma = {} as unknown as PrismaClient;

    caller = workflowRouter.createCaller(ctx);
    mockGetVercelAIModel.mockResolvedValue({ modelId: "openai/gpt-5-mini" });
  });

  describe("when generating against a reasoning model", () => {
    /** @scenario Commit-message generation works for reasoning models */
    it("requests a plain-text completion without function tools", async () => {
      mockGenerateText.mockResolvedValue({ text: "  shorten prompt  " });

      const result = await caller.generateCommitMessage({
        projectId: "project_abc123",
        prevDsl: blankTemplate,
        newDsl: { ...blankTemplate, description: "A different description" },
      });

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      const callArg = mockGenerateText.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      // The combination that gpt-5 rejects on /v1/chat/completions is exactly
      // function tools + reasoning_effort. No tools here, so it never trips.
      expect(callArg).not.toHaveProperty("tools");
      expect(callArg).not.toHaveProperty("toolChoice");
      // The trimmed completion text is returned directly.
      expect(result).toBe("shorten prompt");
    });
  });

  describe("when the DSL is unchanged", () => {
    it("returns 'no changes' without calling the model", async () => {
      const result = await caller.generateCommitMessage({
        projectId: "project_abc123",
        prevDsl: blankTemplate,
        newDsl: blankTemplate,
      });

      expect(result).toBe("no changes");
      expect(mockGenerateText).not.toHaveBeenCalled();
    });
  });
});
