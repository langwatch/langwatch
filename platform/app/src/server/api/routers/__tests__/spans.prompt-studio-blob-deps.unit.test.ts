/**
 * Call-site wiring for the prompt-studio tRPC procedure (#5753).
 *
 * getForPromptStudio built its TraceService with no blob-resolution deps,
 * next to getAllForTrace in the same router which passes them. A service
 * without deps hands the ClickHouse layer no resolver, so the playground
 * opened on the bounded preview no matter what the read path did.
 *
 * Mirrors the traces.4991-full-resolution harness: createCaller with a
 * mocked TraceService and mocked rbac/utils.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { spansRouter } from "../spans";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCreate, mockGetSpanForPromptStudio, mockBuildDeps, BLOB_DEPS } =
  vi.hoisted(() => {
    const BLOB_DEPS = {
      blobStore: { tag: "blobStore" },
      ioExtractionService: { tag: "ioExtractionService" },
    };
    return {
      mockCreate: vi.fn(),
      mockGetSpanForPromptStudio: vi.fn(),
      mockBuildDeps: vi.fn(() => BLOB_DEPS),
      BLOB_DEPS,
    };
  });

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: { create: mockCreate },
}));

vi.mock("~/server/traces/trace-blob-resolution.deps", () => ({
  buildTraceBlobResolutionDeps: mockBuildDeps,
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("../../utils", () => ({
  getUserProtectionsForProject: vi.fn().mockResolvedValue({
    canSeeCosts: true,
    canSeePiiData: true,
    canSeeTopics: true,
  }),
}));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let caller: ReturnType<typeof spansRouter.createCaller>;

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildDeps.mockReturnValue(BLOB_DEPS);
  mockCreate.mockReturnValue({
    getSpanForPromptStudio: mockGetSpanForPromptStudio,
    getTracesWithSpans: vi.fn().mockResolvedValue([]),
  });
  mockGetSpanForPromptStudio.mockResolvedValue({
    spanId: "span-1",
    traceId: "trace-1",
    messages: [],
  });

  const ctx = createInnerTRPCContext({
    session: { user: { id: "test-user-id" }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = {} as unknown as PrismaClient;
  caller = spansRouter.createCaller(ctx);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("spans router, prompt-studio blob-resolution wiring (#5753)", () => {
  describe("when getForPromptStudio is called", () => {
    // Not bound to a scenario: this asserts dependency wiring, which the
    // feature files do not describe. Same class as the traces router's
    // 4991-full-resolution wiring test.
    it("constructs TraceService with the blob-resolution deps", async () => {
      await caller.getForPromptStudio({
        projectId: "project_123",
        spanId: "span-1",
      });

      expect(mockCreate).toHaveBeenCalledWith(expect.anything(), BLOB_DEPS);
    });
  });
});
