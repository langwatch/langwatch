/**
 * The proof-fenced playground read restores the llm span's offloaded content
 * (#5753). The trace-named reader of getForPromptStudio loads stored rows
 * through the proof, then asks the span store to restore the llm row's
 * attributes under that same proof and the plan's visibility window.
 *
 * The App is stubbed at its traces seam (stored-span read, restore, summary
 * authorization), so what is asserted is the router's wiring: which span is
 * restored, under which proof, and what the playground ends up showing.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { AccessNotGrantedError } from "@langwatch/actor";
import type { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { spansRouter } from "../spans";

const {
  mockGetStoredSpans,
  mockRestore,
  mockAuthorizationForTrace,
  mockVisibilityCutoff,
  TRACE_AUTHORIZATION,
} = vi.hoisted(() => ({
  mockGetStoredSpans: vi.fn(),
  mockRestore: vi.fn(),
  mockAuthorizationForTrace: vi.fn(),
  mockVisibilityCutoff: vi.fn(),
  // A distinct object, so "the same proof" is an identity assertion.
  TRACE_AUTHORIZATION: { tag: "narrowed-trace-authorization" },
}));

// The permission seam from the shared mock, extended with the traces seam
// this read goes through.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  const base = appPermissionsMock();
  return {
    ...base,
    getApp: () => ({
      ...base.getApp(),
      traces: {
        spans: {
          getStoredSpansByTraceId: mockGetStoredSpans,
          restoreStoredSpanAttributes: mockRestore,
        },
        summary: { authorizationForTrace: mockAuthorizationForTrace },
      },
    }),
  };
});

// A thrown error is audited by the router middleware; keep that off the database.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock(
  "~/server/app-layer/authz/permission-adapters",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/server/app-layer/authz/permission-adapters")
      >();
    return {
      ...actual,
      hasProjectPermission: vi.fn(() => Promise.resolve(true)),
      resolveProjectPermission: vi
        .fn()
        .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
    };
  },
);

vi.mock("../../utils", () => ({
  getUserProtectionsForProject: vi.fn().mockResolvedValue({
    canSeeCosts: true,
    canSeePiiData: true,
    canSeeTopics: true,
  }),
  getVisibilityCutoffMsForProject: mockVisibilityCutoff,
}));

const TRACE_ID = "trace-1";
const CUTOFF_MS = 1_699_000_000_000;
const FULL_USER_TURN = `Summarise this: ${"x".repeat(70_000)}`;
const PREVIEW_USER_TURN = "Summarise this: xxx…";

const messagesAttribute = (userTurn: string) =>
  JSON.stringify([
    { role: "system", content: "You are a careful assistant." },
    { role: "user", content: userTurn },
  ]);

function storedSpan({
  spanId,
  type,
  parentSpanId = null,
  startTimeUnixMs = 1_700_000_000_000,
  attributes = {},
}: {
  spanId: string;
  type: string;
  parentSpanId?: string | null;
  startTimeUnixMs?: number;
  attributes?: Record<string, string>;
}) {
  return {
    spanId,
    traceId: TRACE_ID,
    parentSpanId,
    name: spanId,
    spanAttributes: { "langwatch.span.type": type, ...attributes },
    startTimeUnixMs,
    endTimeUnixMs: startTimeUnixMs + 100,
    durationMs: 100,
    statusCode: 1,
    statusMessage: null,
  };
}

const llmSpan = () =>
  storedSpan({
    spanId: "span-llm",
    type: "llm",
    parentSpanId: "span-root",
    attributes: { "langwatch.input": messagesAttribute(PREVIEW_USER_TURN) },
  });
const rootSpan = () => storedSpan({ spanId: "span-root", type: "span" });

let caller: ReturnType<typeof spansRouter.createCaller>;

const openPromptStudio = (spanId: string) =>
  caller.getForPromptStudio({
    projectId: "project_123",
    spanId,
    traceId: TRACE_ID,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorizationForTrace.mockResolvedValue(TRACE_AUTHORIZATION);
  mockVisibilityCutoff.mockResolvedValue(CUTOFF_MS);
  mockGetStoredSpans.mockResolvedValue([rootSpan(), llmSpan()]);
  mockRestore.mockResolvedValue({
    "langwatch.span.type": "llm",
    "langwatch.input": messagesAttribute(FULL_USER_TURN),
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

describe("spans router, prompt-studio trace read restores offloaded content (#5753)", () => {
  describe("given a link that names the trace and the llm span", () => {
    describe("when getForPromptStudio is called", () => {
      /** @scenario "A trace-named link opens the full prompt" */
      it("returns the restored user message, not the stored preview", async () => {
        const result = await openPromptStudio("span-llm");

        expect(result.messages.find((m) => m.role === "user")?.content).toBe(
          FULL_USER_TURN,
        );
      });

      /** @scenario "A trace-named link opens the full prompt" */
      it("restores under the very proof the route minted", async () => {
        await openPromptStudio("span-llm");

        expect(mockRestore.mock.calls[0]?.[0].authorization).toBe(
          TRACE_AUTHORIZATION,
        );
      });

      /** @scenario "A trace-named link opens the full prompt" */
      it("restores under the very proof the stored-span read used", async () => {
        await openPromptStudio("span-llm");

        expect(mockRestore.mock.calls[0]?.[0].authorization).toBe(
          mockGetStoredSpans.mock.calls[0]?.[0].authorization,
        );
      });

      /** @scenario "A span outside the plan's visibility window keeps the preview" */
      it("hands the project's visibility cutoff to the restore", async () => {
        await openPromptStudio("span-llm");

        expect(mockVisibilityCutoff).toHaveBeenCalledWith("project_123");
        expect(mockRestore).toHaveBeenCalledWith(
          expect.objectContaining({ visibilityCutoffMs: CUTOFF_MS }),
        );
      });
    });
  });

  describe("given a link that names a non-llm span", () => {
    describe("when getForPromptStudio is called", () => {
      /** @scenario "A trace-named link restores the span the playground opens" */
      it("restores the nearest llm span, not the clicked one", async () => {
        await openPromptStudio("span-root");

        expect(mockRestore).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({ spanId: "span-llm" }),
          }),
        );
      });
    });
  });

  describe("given a proof that is not granted", () => {
    describe("when the restore rejects", () => {
      beforeEach(() => {
        mockRestore.mockRejectedValue(new AccessNotGrantedError("traces:view"));
      });

      /** @scenario "A proof that is not granted is refused, not answered with a preview" */
      it("rejects getForPromptStudio too", async () => {
        await expect(openPromptStudio("span-llm")).rejects.toMatchObject({
          cause: { code: "access_not_granted" },
        });
      });

      /** @scenario "A proof that is not granted is refused, not answered with a preview" */
      it("returns no content", async () => {
        const result = await openPromptStudio("span-llm").catch(
          () => undefined,
        );

        expect(result).toBeUndefined();
      });
    });
  });

  describe("given a span that is not in the trace", () => {
    describe("when getForPromptStudio is called", () => {
      /** @scenario "A span that is not in the trace restores nothing" */
      it("answers not found", async () => {
        await expect(openPromptStudio("span-missing")).rejects.toMatchObject({
          code: "NOT_FOUND",
        } satisfies Partial<TRPCError>);
      });

      /** @scenario "A span that is not in the trace restores nothing" */
      it("never calls the restore", async () => {
        await openPromptStudio("span-missing").catch(() => undefined);

        expect(mockRestore).not.toHaveBeenCalled();
      });
    });
  });
});
