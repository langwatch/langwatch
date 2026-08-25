/**
 * ADR-092 §8 — the mint surface for a share link's permission.
 *
 * The allowlist itself and the refusal are tested at `ShareService`; this
 * harness proves the tRPC mutation is a REAL way in: what a caller sends
 * reaches the service, what a caller omits reaches it as the default, and a
 * value outside the allowlist is refused at the input boundary rather than
 * stored. Without this, the parameter would exist only as a service argument
 * nothing can pass.
 *
 * Mirrors the traces.4991-full-resolution.unit.test.ts harness (createCaller +
 * mocked app layer + mocked rbac).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { shareRouter } from "../share";

const { mockCreateShare, mockGetDecision } = vi.hoisted(() => ({
  mockCreateShare: vi.fn(),
  mockGetDecision: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => {
  // `traces:share` is not what this suite is about, so the permission
  // middleware is answered rather than exercised — the mutation cannot be
  // reached at all otherwise.
  const app = {
    share: { createShare: mockCreateShare },
    permissions: { getDecision: mockGetDecision },
    // The engine gate asks whether any tenant has finished the migration.
    // It caches, so a suite that leaves this out only passes when some
    // earlier file in the same worker happened to warm it — and vitest runs
    // these with `isolate: false`, so that is shard order, not a guarantee.
    // Answering it here makes this suite independent of who ran before it.
    prisma: {
      systemMigrationTenantState: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  };
  return { tryGetApp: () => app, getApp: () => app };
});

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

const PROJECT_ID = "project_1";
const TRACE_ID = "trace_a";

function createCaller() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    req: undefined,
    res: undefined,
  });
  ctx.prisma = {} as unknown as PrismaClient;
  return shareRouter.createCaller(ctx);
}

const mint = async (permission?: string) =>
  createCaller().createShare({
    projectId: PROJECT_ID,
    resourceType: "TRACE",
    resourceId: TRACE_ID,
    ...(permission === undefined ? {} : { permission }),
  } as Parameters<ReturnType<typeof createCaller>["createShare"]>[0]);

describe("share.createShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDecision.mockResolvedValue({
      permitted: true,
      organizationRole: "MEMBER",
    });
    mockCreateShare.mockResolvedValue({ id: "share_1", token: "tok_new" });
  });

  describe("when the caller says nothing about what the link may do", () => {
    /** @scenario "A link minted without a permission stays read-only" */
    it("mints a read-only link, the way every existing caller does", async () => {
      await mint();

      expect(mockCreateShare).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "traces:view" }),
      );
    });
  });

  describe("when the caller names an allowlisted permission", () => {
    /** @scenario "An annotate link lets its holder annotate the shared trace" */
    it("carries it through to the service unchanged", async () => {
      await mint("annotations:create");

      expect(mockCreateShare).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "annotations:create" }),
      );
    });
  });

  describe("when the caller names something a link may not grant", () => {
    /** @scenario "A share link cannot be minted for something it may not grant" */
    it("refuses at the input boundary, before the service is reached", async () => {
      await expect(mint("datasets:manage")).rejects.toThrow();
      expect(mockCreateShare).not.toHaveBeenCalled();
    });
  });
});
