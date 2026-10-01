/**
 * @vitest-environment jsdom
 * The organization graph keeps each project's server-redacted base key behind a
 * lookup and its creation time on the host teams.
 * Spec: specs/features/onboarding/manual-setup-api-key.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const TEST_KEY = "sk-lw-test-fixture-not-a-real-key-000000000000";

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
            apiKey: TEST_KEY,
            createdAt: "2026-09-01T00:00:00Z",
          },
          {
            id: "proj_withheld",
            name: "Withheld",
            slug: "acme-withheld",
            apiKey: "",
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
  describe("when the graph lists a managed project and one whose key the server withheld", () => {
    /** @scenario "The organization graph keeps each project's key and creation time" */
    it("answers the managed key, no key for the withheld one, and keeps creation times", () => {
      const { result } = renderHook(() =>
        useOnboardingOrganizationGraph({ organizationId: "org_1", projectId: void 0 }),
      );

      expect(result.current.projectApiKey("proj_managed")).toBe(TEST_KEY);
      expect(result.current.projectApiKey("proj_withheld")).toBeUndefined();
      expect(result.current.projectApiKey("proj_unknown")).toBeUndefined();
      expect(result.current.organization?.teams[0]?.projects.map((p) => p.createdAt)).toEqual([
        "2026-09-01T00:00:00Z",
        "2026-09-02T00:00:00Z",
      ]);
    });
  });
});
