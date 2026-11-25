/**
 * @vitest-environment jsdom
 * While `routingPolicy.personalContext` answers personal_workspace_pending the hook reports a
 * pending workspace, not a resolved one; once it answers the flag drops.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { context } = vi.hoisted(() => ({ context: { current: {} as Record<string, unknown> } }));

vi.mock("../personal-workspace-api.ts", () => {
  const procedure = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () =>
              path.join(".") === "routingPolicy.personalContext" ? context.current : {};
          }
          return procedure([...path, property]);
        },
      },
    );
  return { api: procedure([]) };
});

vi.mock("../personal-workspace-session.ts", () => ({
  useCurrentUser: () => ({ id: "usr_1", email: "jane@acme.dev", name: "Jane" }),
  useOrganizationTeamProject: () => ({ organization: { id: "org_1", name: "ACME" } }),
}));

import { usePersonalContext } from "../use-personal-context.ts";

const pendingWorkspace = Object.assign(new Error("personal_workspace_pending"), {
  data: {
    httpStatus: 409,
    error: { code: "personal_workspace_pending", httpStatus: 409, fault: "platform", meta: {} },
  },
});

describe("usePersonalContext", () => {
  afterEach(() => {
    context.current = {};
  });

  describe("when the personal workspace is still being created", () => {
    it("reports pending and not resolved, with no project", () => {
      context.current = { isSuccess: false, failureReason: pendingWorkspace };
      const { result } = renderHook(() => usePersonalContext());

      expect(result.current.isWorkspacePending).toBe(true);
      expect(result.current.isPersonalProjectResolved).toBe(false);
      expect(result.current.personalProjectId).toBeNull();
    });
  });

  describe("when the read later answers", () => {
    it("reports resolved and no longer pending", () => {
      context.current = {
        isSuccess: true,
        failureReason: null,
        data: {
          workspace: { team: { createdAtMs: 0 }, project: { id: "proj_me", slug: "me" } },
          routingPolicy: null,
        },
      };
      const { result } = renderHook(() => usePersonalContext());

      expect(result.current.isWorkspacePending).toBe(false);
      expect(result.current.personalProjectId).toBe("proj_me");
    });
  });
});
