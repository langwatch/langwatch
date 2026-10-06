/**
 * @vitest-environment jsdom
 *
 * The department lists are asked for only by a viewer who may read them.
 * @see specs/ai-gateway/governance/departments.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  canViewGovernance: true,
  /** Whether each department query asked the server, in call order. */
  asked: [] as boolean[],
}));

vi.mock("../use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    hasPermission: (permission: string) =>
      permission !== "governance:view" || harness.canViewGovernance,
  }),
}));

vi.mock("../organization-api.ts", () => {
  const query = (_input: unknown, options?: { enabled?: boolean }) => {
    harness.asked.push(options?.enabled !== false);
    return { data: undefined };
  };
  return {
    api: {
      useUtils: () => ({ departments: { assignments: { invalidate: vi.fn() } } }),
      departments: { list: { useQuery: query }, assignments: { useQuery: query } },
    },
  };
});

import { useDepartmentColumn } from "../use-department-column.ts";

beforeEach(() => {
  harness.canViewGovernance = true;
  harness.asked = [];
});

describe("given AI governance is on for the organization", () => {
  describe("when the viewer does not hold governance:view", () => {
    /** @scenario The department lists are not requested without the grant to read them */
    it("asks for neither the departments nor their assignments, and shows no column", () => {
      harness.canViewGovernance = false;

      const { result } = renderHook(() => useDepartmentColumn("org-1", true));

      expect(harness.asked).toEqual([false, false]);
      expect(result.current.show).toBe(false);
    });
  });

  describe("when the viewer holds governance:view", () => {
    it("asks for both", () => {
      renderHook(() => useDepartmentColumn("org-1", true));

      expect(harness.asked).toEqual([true, true]);
    });
  });
});
