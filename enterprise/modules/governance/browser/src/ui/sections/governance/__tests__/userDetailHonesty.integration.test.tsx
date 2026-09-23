/**
 * @vitest-environment jsdom
 * User detail page: claims about unavailable breakdowns (same rule as team detail page).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACTOR = "ada@acme.test";

const harness = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: { id: "ada@acme.test" } }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));
vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));
vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../../behavior/governance-api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof governanceApiModule>()),
  api: {
    activityMonitor: {
      spendByUser: {
        useQuery: () => ({
          data: harness.rows,
          isLoading: false,
          error: null,
        }),
      },
    },
    governance: {
      resolveActorPersonalProject: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
    },
  },
}));

import type * as governanceApiModule from "../../../../behavior/governance-api.ts";
import UserDetailPage from "../governance-user.screen.tsx";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <UserDetailPage />
    </ChakraProvider>,
  );

beforeEach(() => {
  harness.rows = [
    {
      actor: ACTOR,
      spendUsd: 4.25,
      requests: 118,
      lastActivityIso: new Date().toISOString(),
      mostUsedTarget: "gpt-5-mini",
    },
  ];
});

afterEach(() => {
  cleanup();
});

describe("given a person with spend in the window", () => {
  /** @scenario "The person page names the breakdowns it does not have yet" */
  it("says the deeper breakdowns are not available yet", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: ACTOR })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Per-day spend trend and per-model breakdown for this user are not available yet.",
      ),
    ).toBeInTheDocument();
  });

  /** @scenario "The person page names the breakdowns it does not have yet" */
  it("never describes them as arriving in a follow-up", () => {
    renderPage();

    const shown = document.body.textContent ?? "";
    // The guard: prove the page rendered before asserting these absences.
    expect(shown).toContain(ACTOR);
    // Our release plan is not something a reader can act on.
    for (const plan of [/follow-up/i, /will land here/i]) {
      expect(shown).not.toMatch(plan);
    }
  });
});
