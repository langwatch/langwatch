/**
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableScopes } from "../useAvailableScopes";
import { useUrlScopeFilter } from "../useUrlScopeFilter";

const mockRouterQuery: Record<string, string> = {};
const mockRouterReplace = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    replace: mockRouterReplace,
  }),
}));

const filterAvailable: AvailableScopes = {
  organization: { id: "org-1", name: "Acme Corp" },
  teams: [{ id: "team-1", name: "Team Red" }],
  projects: [{ id: "proj-1", name: "Project Alpha", teamId: "team-1" }],
};

describe("useUrlScopeFilter()", () => {
  beforeEach(() => {
    mockRouterReplace.mockReset();
    for (const key of Object.keys(mockRouterQuery)) {
      delete mockRouterQuery[key];
    }
  });

  describe("given a valid scoped URL was active", () => {
    describe("when the scope query param is removed", () => {
      /** @regression */
      it("returns to the all-scopes filter", async () => {
        mockRouterQuery.scope = "TEAM:team-1";

        const { result, rerender } = renderHook(() =>
          useUrlScopeFilter({
            filterAvailable,
            teamId: "team-1",
            projectId: "proj-1",
          }),
        );

        await waitFor(() => {
          expect(result.current[0]).toMatchObject({
            kind: "specific",
            scopeType: "TEAM",
            scopeId: "team-1",
            name: "Team Red",
          });
        });

        delete mockRouterQuery.scope;
        rerender();

        await waitFor(() => {
          expect(result.current[0]).toEqual({ kind: "all" });
        });
      });
    });

    describe("when the scope query param becomes malformed", () => {
      /** @regression */
      it("returns to the all-scopes filter", async () => {
        mockRouterQuery.scope = "TEAM:team-1";

        const { result, rerender } = renderHook(() =>
          useUrlScopeFilter({
            filterAvailable,
            teamId: "team-1",
            projectId: "proj-1",
          }),
        );

        await waitFor(() => {
          expect(result.current[0]).toMatchObject({ kind: "specific" });
        });

        mockRouterQuery.scope = "TEAM";
        rerender();

        await waitFor(() => {
          expect(result.current[0]).toEqual({ kind: "all" });
        });
      });
    });
  });
});
