/**
 * @vitest-environment jsdom
 *
 * The team detail page, mounted through its real page and guards. What is
 * under test is what the page CLAIMS: it names the breakdowns it does not
 * have instead of describing them as work under way, it offers no control
 * that answers a press with nothing, and it describes its two links in the
 * reader's own words rather than ours.
 *
 * Spec: specs/ai-governance/dashboard/team-detail-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEAM_ID = "team-1";
const TEAM_NAME = "Platform";
const PROJECT_SLUG = "platform-project";

const harness = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: { id: "team-1" } }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [
      {
        teams: [{ id: "team-1", projects: [{ slug: "platform-project" }] }],
      },
    ],
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
vi.mock("~/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/api")>()),
  api: {
    activityMonitor: {
      spendByTeam: {
        useQuery: () => ({
          data: harness.rows,
          isLoading: false,
          error: null,
        }),
      },
    },
  },
}));

import TeamDetailPage from "../teams/[id]";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TeamDetailPage />
    </ChakraProvider>,
  );

beforeEach(() => {
  harness.rows = [
    {
      teamId: TEAM_ID,
      teamName: TEAM_NAME,
      spendUsd: 12.5,
      requestCount: 340,
      lastActivityIso: new Date().toISOString(),
      sourceCount: 2,
    },
  ];
});

afterEach(() => {
  cleanup();
});

describe("given a team with spend in the window", () => {
  /** @scenario "The page names the breakdowns it does not have yet" */
  it("says the deeper breakdowns are not available yet", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: TEAM_NAME }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Per-day spend, per-user breakdown and model mix for this team are not available yet.",
      ),
    ).toBeInTheDocument();
    // Our release plan is not something a reader can act on.
    expect(screen.queryByText(/follow-up/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/will land here/i)).not.toBeInTheDocument();
  });

  /** @scenario "The links describe where they land in the reader's own words" */
  it("describes both links without jargon or an internal route", () => {
    renderPage();

    expect(
      screen.getByRole("link", { name: /workspace traces/ }),
    ).toHaveAttribute("href", `/${PROJECT_SLUG}/traces`);
    expect(
      screen.getByText(/A 'Viewing as admin' banner stays on screen/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/shows this team's spend next to every other team's/),
    ).toBeInTheDocument();

    const shown = document.body.textContent ?? "";
    // The guard: prove the page rendered before asserting these absences.
    expect(shown).toContain(TEAM_NAME);
    for (const jargon of [
      /orthogonal/i,
      /drilldown/i,
      /\/settings\/audit-log/,
      /stays present \+/,
    ]) {
      expect(shown).not.toMatch(jargon);
    }
  });

  /** @scenario "Every control on the page navigates somewhere real" */
  it("offers only links, each with a destination", () => {
    renderPage();

    // Nothing on this page is a button, so nothing on it can be inert: every
    // control is a link, and every link resolves somewhere.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const links = screen.getAllByRole("link");
    // The guard against a vacuous pass: an empty list would satisfy the
    // loop below without proving anything about the page's controls.
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBeTruthy();
    }
  });

  /** @scenario "Every control on the page navigates somewhere real" */
  it("offers no control without a handler in the source", () => {
    const source = readFileSync(
      join(process.cwd(), "src/pages/governance/teams/[id].tsx"),
      "utf-8",
    );
    // Read from the source for the same reason the Platform screens are:
    // a render only proves the controls a test named do something, and a
    // `<Button>` added here later would carry no handler unnoticed.
    expect(source).toContain("<Link");
    expect(source.match(/<Button\b/g) ?? []).toHaveLength(0);
  });
});
