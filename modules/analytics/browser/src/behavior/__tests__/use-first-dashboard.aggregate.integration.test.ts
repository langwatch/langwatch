/**
 * @vitest-environment jsdom
 * The first dashboard is created on read, which an aggregate refuses (ADR-175
 * decision 8), so its reports never ask it. @see specs/governance/aggregate-project.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock, project } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  project: { id: "project-1", kind: "application" as string },
}));

vi.mock("../analytics-api.ts", () => ({
  analyticsApi: { dashboards: { getOrCreateFirst: { useQuery: useQueryMock } } },
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project }),
}));

import { useFirstDashboard } from "../use-dashboards.ts";

function askedEnabled(): unknown {
  return useQueryMock.mock.calls.at(-1)?.[1]?.enabled;
}

describe("useFirstDashboard()", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue({ data: void 0 });
  });

  describe("given an aggregate project", () => {
    it("never asks for the first dashboard", () => {
      project.kind = "aggregate";

      renderHook(() => useFirstDashboard({ projectId: "project-1", enabled: true }));

      expect(askedEnabled()).toBe(false);
    });
  });

  describe("given an ordinary project", () => {
    it("asks for the first dashboard", () => {
      project.kind = "application";

      renderHook(() => useFirstDashboard({ projectId: "project-1", enabled: true }));

      expect(askedEnabled()).toBe(true);
    });
  });
});
