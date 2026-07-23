import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ONE collaborator: the authoritative decision. This test covers only
// the transport wrapper (deny -> LangyNotEnabledError, allow -> next, scope
// forwarding); the decision itself is covered by langyAccessGate.unit.test.ts.
const { hasLangyAccess, resolveOrganizationId } = vi.hoisted(() => ({
  hasLangyAccess: vi.fn(),
  resolveOrganizationId: vi.fn(),
}));
vi.mock("~/server/app-layer/langy/langyAccessGate", () => ({ hasLangyAccess }));
vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId,
}));

import { enforceLangyAccess } from "../langyAccessMiddleware";
import { LangyNotEnabledError } from "~/server/app-layer/langy/errors";

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
    it("throws a handled LangyNotEnabledError (kind + 404) and never calls next", async () => {
      hasLangyAccess.mockResolvedValue(false);

      const { result, next } = invoke({ projectId: "project-1" });

      // A typed handled error, not a bare TRPCError: handledErrorMiddleware maps
      // its 404 to NOT_FOUND downstream and serialises `code: langy_not_enabled`
      // so the client renders a real "not enabled" state, not a load failure.
      await expect(result).rejects.toBeInstanceOf(LangyNotEnabledError);
      await expect(result).rejects.toMatchObject({
        code: "langy_not_enabled",
        httpStatus: 404,
      });
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

describe("given a project-scoped call and an org-scoped rollout rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasLangyAccess.mockResolvedValue(true);
  });

  // The bug: the project-scoped procedures only ever carry a projectId, so
  // reading the scope straight off the input evaluated the flag with NO
  // organization — every org-targeted rule missed, and an opted-in account was
  // told Langy was not enabled.
  it("resolves the organization from the project and passes it to the gate", async () => {
    resolveOrganizationId.mockResolvedValue("org-9");

    const { result } = invoke({ projectId: "project-1" });
    await result;

    expect(resolveOrganizationId).toHaveBeenCalledWith("project-1");
    expect(hasLangyAccess).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", organizationId: "org-9" }),
    );
  });

  it("keeps an explicit organizationId, which the org-scoped routers already carry", async () => {
    const { result } = invoke({ organizationId: "org-explicit" });
    await result;

    expect(resolveOrganizationId).not.toHaveBeenCalled();
    expect(hasLangyAccess).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-explicit" }),
    );
  });

  it("still evaluates the flag when the project has no organization", async () => {
    // An orphan project must not become an unhandled failure; the gate simply
    // decides without an org scope, exactly as it did before.
    resolveOrganizationId.mockResolvedValue(undefined);

    const { result } = invoke({ projectId: "project-orphan" });
    await result;

    expect(hasLangyAccess).toHaveBeenCalledWith(
      expect.not.objectContaining({ organizationId: expect.anything() }),
    );
  });
});
