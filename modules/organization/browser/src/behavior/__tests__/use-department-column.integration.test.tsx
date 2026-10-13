/**
 * @vitest-environment jsdom
 * The department control sits on pages every member can open; its lists need `governance:view`.
 * @see specs/ai-gateway/governance/departments.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../testing.tsx";
import { useDepartmentColumn } from "../use-department-column.ts";

const state = vi.hoisted(() => ({
  /** Whether each department query asked the server, in call order. */
  enabled: [] as boolean[],
}));

vi.mock("../organization-api.ts", () => {
  const query = (_input: unknown, options?: { enabled?: boolean }) => {
    state.enabled.push(options?.enabled !== false);
    return { data: undefined, isLoading: false };
  };
  return {
    api: {
      departments: {
        list: {
          useQuery: (input: unknown, options?: { enabled?: boolean }) => ({
            ...query(input, options),
            data: [{ id: "dept_mkt", name: "Marketing" }],
          }),
        },
        assignments: { useQuery: query },
      },
      useUtils: () => ({ departments: { assignments: { invalidate: vi.fn() } } }),
    },
  };
});

function DepartmentColumnProbe() {
  const department = useDepartmentColumn("org-1", true);
  return <div data-testid="show">{String(department.show)}</div>;
}

const renderProbe = (grants: string[]) =>
  renderWithOrganizationHost(
    <DepartmentColumnProbe />,
    new FakeOrganizationHost({ grants: new Set(grants) }),
  );

beforeEach(() => {
  state.enabled = [];
});

afterEach(() => cleanup());

describe("useDepartmentColumn", () => {
  describe("given a member without the governance:view grant", () => {
    /** @scenario "The department lists are not requested without the grant to read them" */
    it("asks for neither the departments nor their assignments, and shows no column", () => {
      renderProbe(["organization:view"]);

      expect(state.enabled).toEqual([false, false]);
      expect(screen.getByTestId("show").textContent).toBe("false");
    });
  });

  describe("given a member who holds the governance:view grant", () => {
    it("asks for both the departments and their assignments", () => {
      renderProbe(["organization:view", "governance:view"]);

      expect(state.enabled).toEqual([true, true]);
      expect(screen.getByTestId("show").textContent).toBe("true");
    });
  });
});
