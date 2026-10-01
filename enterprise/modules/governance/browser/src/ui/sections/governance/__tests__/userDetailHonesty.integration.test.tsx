/**
 * @vitest-environment jsdom
 * User detail page: claims about unavailable breakdowns (same rule as team detail page).
 */
import { cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACTOR = "ada@acme.test";

const harness = vi.hoisted(() => ({
  rows: [] as unknown[],
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
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import UserDetailPage from "../governance-user.screen.tsx";

const renderPage = () =>
  renderWithGovernanceHost(<UserDetailPage />, {
    host: fakeGovernanceHost({
      params: { id: ACTOR },
      permissions: ["governance:view", "activityMonitor:view"],
    }),
  });

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

describe("given a person with no spend in the window", () => {
  it("shows who they are above an empty state that says where spend will appear", () => {
    harness.rows = [];
    renderPage();

    expect(screen.getByRole("link", { name: "People" })).toBeInTheDocument();
    expect(screen.getByText("No spend yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Spend appears here once this person uses a governed AI tool or virtual key.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all people" })).toBeInTheDocument();
    expect(screen.getAllByText(ACTOR).length).toBeGreaterThan(0);
  });
});
