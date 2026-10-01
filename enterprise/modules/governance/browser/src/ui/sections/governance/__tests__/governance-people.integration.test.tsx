/**
 * @vitest-environment jsdom
 * Tests departments and assignment surfaces (not member list with dropdowns).
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/governance-api.ts", () => {
  const dataFor = (path: string): unknown => {
    if (path === "departments.list") return [{ id: "dept_mkt", name: "Marketing" }];
    if (path === "departments.assignments") return { users: [], teams: [], projects: [] };
    if (path === "governancePeople.list" || path === "governancePeople.suggestions") return [];
    return undefined;
  };
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({
              data: dataFor(path.join(".")),
              isLoading: false,
              isFetching: false,
              isError: false,
              error: null,
              refetch: vi.fn(),
            });
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  return { api: node([]) };
});

const { fakeGovernanceHost, renderWithGovernanceHost } = await import("../../../../testing.tsx");
const PeoplePage = (await import("../governance-people.screen.tsx")).default;

afterEach(cleanup);

function renderDepartmentsTab() {
  return renderWithGovernanceHost(<PeoplePage />, {
    host: fakeGovernanceHost({
      permissions: ["governance:manage"],
      query: { tab: "departments" },
    }),
  });
}

describe("given the departments page", () => {
  describe("when an admin opens it", () => {
    /** @scenario The departments page manages departments and links out to assign them */
    it("manages departments and links to the members and teams pages instead of listing every person", async () => {
      renderDepartmentsTab();

      expect(screen.getByText("Add department")).toBeDefined();

      // The three assignment links sit behind a disclosure rather than
      // filling the tab; they still point at the settings pages that assign.
      await userEvent.click(screen.getByRole("button", { name: /How departments are assigned/i }));
      await waitFor(() => {
        expect(screen.getByRole("link", { name: /^People/i })).toBeDefined();
      });

      expect(screen.getByRole("link", { name: /People/i }).getAttribute("href")).toBe(
        "/settings/members",
      );
      expect(screen.getByRole("link", { name: /^Teams/i }).getAttribute("href")).toBe(
        "/settings/teams",
      );
      expect(screen.getByRole("link", { name: /^Projects/i }).getAttribute("href")).toBe(
        "/settings/teams",
      );
      // The per-person assignment list is gone: no <select> on the page.
      expect(document.querySelector("select")).toBeNull();
    });
  });
});
