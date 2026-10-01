/**
 * @vitest-environment jsdom
 * The organization graph carries no project key, and keeps each project's creation
 * time on the host teams.
 * Spec: specs/features/onboarding/manual-setup-api-key.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const graph = [
  {
    id: "org_1",
    name: "ACME",
    primaryIntent: "LLM_OPS",
    teams: [
      {
        id: "team_1",
        name: "ACME",
        isPersonal: false,
        projects: [
          {
            id: "proj_managed",
            name: "Managed",
            slug: "acme-managed",
            createdAt: "2026-09-01T00:00:00Z",
          },
          {
            id: "proj_withheld",
            name: "Withheld",
            slug: "acme-withheld",
            createdAt: "2026-09-02T00:00:00Z",
          },
        ],
      },
    ],
  },
];

vi.mock("../onboarding-api.ts", () => ({
  onboardingApi: {
    organization: { getAll: { useQuery: () => ({ data: graph, isLoading: false }) } },
  },
}));

import { useOnboardingOrganizationGraph } from "../onboarding-organization-graph.ts";

describe("useOnboardingOrganizationGraph", () => {
  describe("when the graph lists two projects", () => {
    /** @scenario "The organization graph carries no project key and keeps each creation time" */
    it("offers no key lookup, and keeps creation times", () => {
      const { result } = renderHook(() =>
        useOnboardingOrganizationGraph({ organizationId: "org_1", projectId: void 0 }),
      );

      expect(result.current).not.toHaveProperty("projectApiKey");
      expect(result.current.organization?.teams[0]?.projects.map((p) => p.createdAt)).toEqual([
        "2026-09-01T00:00:00Z",
        "2026-09-02T00:00:00Z",
      ]);
    });
  });
});
