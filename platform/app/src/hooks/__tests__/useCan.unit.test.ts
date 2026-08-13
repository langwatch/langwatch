/**
 * @vitest-environment jsdom
 *
 * The client half of ADR-092 §5: `can()` answers from the server's effective
 * set, applying the same hierarchy the engine does, and it FAILS CLOSED
 * whenever it has no set to answer from.
 *
 * The loading half is the trap. React Query v4 reports a DISABLED query as
 * `isLoading` forever, and this query is disabled until there is an
 * organization or a project to ask about — so the hook reports
 * `isInitialLoading`, which means "a fetch this hook actually started has not
 * answered yet". The test renders the hook and reads its answers; it does not
 * assert on source text.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEffectivePermissionsQuery } = vi.hoisted(() => ({
  mockEffectivePermissionsQuery: vi.fn(),
}));

vi.mock("../../utils/api", () => ({
  api: {
    authz: {
      effectivePermissions: { useQuery: mockEffectivePermissionsQuery },
    },
  },
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

const { useCan } = await import("../useCan");

/** A React Query v4 result, only the fields this hook reads. */
const queryResult = ({
  permissions,
  isInitialLoading = false,
}: {
  permissions?: string[];
  isInitialLoading?: boolean;
}) => ({
  data: permissions ? { permissions } : undefined,
  // Deliberately opposite to isInitialLoading in the loaded cases: a hook
  // reading this field instead would report the disabled-query answer.
  isLoading: permissions === undefined,
  isInitialLoading,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("useCan", () => {
  describe("given the server has answered with an effective set", () => {
    it("satisfies a narrower permission from a broader grant", () => {
      mockEffectivePermissionsQuery.mockReturnValue(
        queryResult({ permissions: ["datasets:manage"] }),
      );

      const { result } = renderHook(() => useCan());

      // manage implies view — the same pure helper the engine decides with.
      expect(result.current.can("datasets:view")).toBe(true);
      expect(result.current.can("datasets:manage")).toBe(true);
      expect(result.current.can("prompts:view")).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });

    it("does not read a grant backwards, so view never implies manage", () => {
      mockEffectivePermissionsQuery.mockReturnValue(
        queryResult({ permissions: ["datasets:view"] }),
      );

      const { result } = renderHook(() => useCan());

      expect(result.current.can("datasets:view")).toBe(true);
      expect(result.current.can("datasets:manage")).toBe(false);
    });
  });

  describe("given the query has not answered yet", () => {
    it("refuses everything, unlike the legacy guard that rendered during load", () => {
      mockEffectivePermissionsQuery.mockReturnValue(
        queryResult({ isInitialLoading: true }),
      );

      const { result } = renderHook(() => useCan());

      expect(result.current.can("datasets:view")).toBe(false);
      expect(result.current.isLoading).toBe(true);
      expect(result.current.permissions).toEqual([]);
    });
  });

  describe("given a query that is disabled rather than in flight", () => {
    it("does not report loading, so a gated screen still renders", () => {
      // React Query v4's isLoading is true for a disabled query forever;
      // isInitialLoading is false, which is the honest answer.
      mockEffectivePermissionsQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isInitialLoading: false,
      });

      const { result } = renderHook(() => useCan());

      expect(result.current.isLoading).toBe(false);
      expect(result.current.can("datasets:view")).toBe(false);
    });
  });
});
