/**
 * @vitest-environment jsdom
 *
 * The client half of ADR-092 §5: `can()` answers from the server's effective
 * set, applying the same hierarchy the engine does, and it FAILS CLOSED
 * whenever it has no set to answer from.
 *
 * The organization hook owns fetching and permission matching. This test
 * keeps the adapter small: it proves `useCan` reuses that canonical answer
 * and carries its fail-closed loading state through.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockWorkspace } = vi.hoisted(() => ({
  mockWorkspace: {
    hasPermission: vi.fn(),
    permissionIsLoading: false,
    effectivePermissions: [] as string[],
  },
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => mockWorkspace,
}));

import { useCan } from "../useCan";

function answerWith(permissions: string[], isLoading = false) {
  mockWorkspace.effectivePermissions = permissions;
  mockWorkspace.permissionIsLoading = isLoading;
  mockWorkspace.hasPermission.mockImplementation(
    (permission: string) =>
      permissions.includes(permission) ||
      (permissions.includes("datasets:manage") &&
        permission === "datasets:view"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspace.permissionIsLoading = false;
  mockWorkspace.effectivePermissions = [];
});

afterEach(() => {
  cleanup();
});

describe("useCan", () => {
  describe("given the server has answered with an effective set", () => {
    it("satisfies a narrower permission from a broader grant", () => {
      answerWith(["datasets:manage"]);

      const { result } = renderHook(() => useCan());

      // manage implies view — the same pure helper the engine decides with.
      expect(result.current.can("datasets:view")).toBe(true);
      expect(result.current.can("datasets:manage")).toBe(true);
      expect(result.current.can("prompts:view")).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });

    it("does not read a grant backwards, so view never implies manage", () => {
      answerWith(["datasets:view"]);

      const { result } = renderHook(() => useCan());

      expect(result.current.can("datasets:view")).toBe(true);
      expect(result.current.can("datasets:manage")).toBe(false);
    });
  });

  describe("given the query has not answered yet", () => {
    it("refuses everything, unlike the legacy guard that rendered during load", () => {
      answerWith([], true);

      const { result } = renderHook(() => useCan());

      expect(result.current.can("datasets:view")).toBe(false);
      expect(result.current.isLoading).toBe(true);
      expect(result.current.permissions).toEqual([]);
    });
  });

  describe("given a query that is disabled rather than in flight", () => {
    it("does not report loading, so a gated screen still renders", () => {
      answerWith([]);

      const { result } = renderHook(() => useCan());

      expect(result.current.isLoading).toBe(false);
      expect(result.current.can("datasets:view")).toBe(false);
    });
  });
});
