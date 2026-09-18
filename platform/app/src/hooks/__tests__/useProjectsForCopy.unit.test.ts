/** @vitest-environment jsdom */

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseQueries, mockWorkspace } = vi.hoisted(() => ({
  mockUseQueries: vi.fn(),
  mockWorkspace: { organizations: undefined as unknown },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => mockWorkspace,
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user_ana" } } }),
}));

vi.mock("~/utils/api", () => ({ api: { useQueries: mockUseQueries } }));

import { useProjectsForCopy } from "../useProjectsForCopy";

const ORGANIZATIONS = [
  {
    name: "Acme",
    teams: [
      {
        name: "Data",
        members: [{ userId: "user_ana", role: "CUSTOM" }],
        projects: [{ id: "project_allowed", name: "Allowed" }],
      },
      {
        name: "Research",
        members: [{ userId: "user_ana", role: "MEMBER" }],
        projects: [{ id: "project_denied", name: "Denied" }],
      },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspace.organizations = ORGANIZATIONS;
  mockUseQueries.mockImplementation((build: (tools: unknown) => unknown[]) =>
    build({
      authz: {
        effectivePermissions: ({ projectId }: { projectId: string }) => ({
          data: {
            permissions:
              projectId === "project_allowed" ? ["datasets:manage"] : [],
          },
        }),
      },
    }),
  );
});

afterEach(cleanup);

describe("useProjectsForCopy", () => {
  it("uses each target project's effective permissions", () => {
    const { result } = renderHook(() => useProjectsForCopy("datasets:create"));

    expect(result.current).toEqual([
      {
        label: "Acme / Data / Allowed",
        value: "project_allowed",
        hasCreatePermission: true,
      },
      {
        label: "Acme / Research / Denied",
        value: "project_denied",
        hasCreatePermission: false,
      },
    ]);
    expect(mockUseQueries).toHaveBeenCalledTimes(1);
  });
});
