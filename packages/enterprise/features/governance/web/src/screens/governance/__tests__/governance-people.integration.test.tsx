/**
 * @vitest-environment jsdom
 *
 * The People page, and what it deliberately is not.
 *
 * It manages departments and points at the two surfaces where a person or a
 * team is actually assigned to one; it does not list every member with a
 * dropdown beside them, which is what it used to do and what made it unusable
 * at any real headcount. `platform/app/src/components/settings/__tests__/departmentAssignment.integration.test.tsx`
 * pinned that shape while the page lived in the application, and it moves here
 * with the page. The picker and the members-table column stay in `platform/app`
 * with their own two scenarios.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const departments = {
  current: [
    {
      id: "dept_mkt",
      name: "Marketing",
      organizationId: "org-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

vi.mock("../../../behavior/governance-api", () => ({
  api: {
    useUtils: () => ({ departments: { list: { invalidate: vi.fn() } } }),
    departments: {
      list: { useQuery: () => ({ data: departments.current, isLoading: false, error: null }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      rename: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

const { fakeGovernanceHost, renderWithGovernanceHost } = await import("../../../testing");
const PeoplePage = (await import("../governance-people.screen")).default;

afterEach(cleanup);

function renderPeople() {
  return renderWithGovernanceHost(<PeoplePage />, {
    host: fakeGovernanceHost({ permissions: ["governance:manage"] }),
  });
}

describe("given the departments page", () => {
  describe("when an admin opens it", () => {
    /** @scenario The departments page manages departments and links out to assign them */
    it("manages departments and links to the members and teams pages instead of listing every person", () => {
      renderPeople();

      // Scoped to the page's own column: the section rail beside it also links
      // to a destination called People, and it is not the one under test.
      const page = within(screen.getByTestId("section-navigation-content"));

      expect(page.getByText("Create a department")).toBeDefined();
      expect(page.getByRole("link", { name: /People/i }).getAttribute("href")).toBe(
        "/settings/members",
      );
      // Anchored to the link title: the Projects link also mentions the teams
      // page in its description and points at /settings/teams too.
      expect(page.getByRole("link", { name: /^Teams/i }).getAttribute("href")).toBe(
        "/settings/teams",
      );
      expect(page.getByRole("link", { name: /^Projects/i }).getAttribute("href")).toBe(
        "/settings/teams",
      );
      // The per-person assignment list is gone: no <select> on the page.
      expect(document.querySelector("select")).toBeNull();
    });
  });
});
