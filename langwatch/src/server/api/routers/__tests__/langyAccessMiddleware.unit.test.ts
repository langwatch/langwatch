import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ONE collaborator: the authoritative decision. This test covers only
// the transport wrapper (deny -> NOT_FOUND, allow -> next, scope forwarding);
// the decision itself is covered by langyAccessGate.unit.test.ts.
const { hasLangyAccess } = vi.hoisted(() => ({ hasLangyAccess: vi.fn() }));
vi.mock("~/server/app-layer/langy/langyAccessGate", () => ({ hasLangyAccess }));

import { enforceLangyAccess } from "../langyAccessMiddleware";

const user = { id: "user-1", email: "user@example.com", emailVerified: true };

function invoke(input: { projectId?: string; organizationId?: string }) {
  const next = vi.fn().mockResolvedValue("NEXT_RESULT");
  const result = enforceLangyAccess({
    ctx: { session: { user } },
    input,
    next,
    // deliberately loose: this middleware only reads ctx.session.user + input
  } as unknown as Parameters<typeof enforceLangyAccess>[0]);
  return { result, next };
}

describe("enforceLangyAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the gate allows the caller", () => {
    it("calls next and returns its result", async () => {
      hasLangyAccess.mockResolvedValue(true);

      const { result, next } = invoke({ projectId: "project-1" });

      await expect(result).resolves.toBe("NEXT_RESULT");
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe("when the gate denies the caller", () => {
    it("throws NOT_FOUND and never calls next", async () => {
      hasLangyAccess.mockResolvedValue(false);

      const { result, next } = invoke({ projectId: "project-1" });

      await expect(result).rejects.toBeInstanceOf(TRPCError);
      await expect(result).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when the procedure is project-scoped", () => {
    it("forwards the projectId to the gate", async () => {
      hasLangyAccess.mockResolvedValue(true);

      await invoke({ projectId: "project-1" }).result;

      expect(hasLangyAccess).toHaveBeenCalledWith({
        user,
        projectId: "project-1",
      });
    });
  });

  describe("when the procedure is org-scoped", () => {
    it("forwards the organizationId to the gate", async () => {
      hasLangyAccess.mockResolvedValue(true);

      await invoke({ organizationId: "org-1" }).result;

      expect(hasLangyAccess).toHaveBeenCalledWith({
        user,
        organizationId: "org-1",
      });
    });
  });
});
