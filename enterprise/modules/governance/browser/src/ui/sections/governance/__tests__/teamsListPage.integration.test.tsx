// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The all-teams page: what its panel says when the team activity read
 * answers, answers with nothing, or fails.
 *
 * Only the tRPC client is doubled.
 *
 * Spec: specs/ai-governance/dashboard/teams-list-page.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  teams: {
    data: undefined as unknown,
    isPending: false,
    isLoading: false,
    error: null as unknown,
  },
  refetch: vi.fn(),
}));

vi.mock("../../../../behavior/governance-api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof governanceApiModule>()),
  api: {
    activityMonitor: {
      spendByTeam: { useQuery: () => ({ ...harness.teams, refetch: harness.refetch }) },
    },
  },
}));

import type * as governanceApiModule from "../../../../behavior/governance-api.ts";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import TeamsListPage from "../governance-teams.screen.tsx";

const TEAM = {
  teamId: "team-1",
  teamName: "Platform",
  spendUsd: 12.5,
  requestCount: 340,
  lastActivityIso: new Date().toISOString(),
  sourceCount: 2,
  deltaPctVsPriorWindow: 0,
  hasPriorBaseline: false,
};

const renderPage = () =>
  renderWithGovernanceHost(<TeamsListPage />, {
    host: fakeGovernanceHost({ permissions: ["governance:view", "activityMonitor:view"] }),
  });

beforeEach(() => {
  harness.teams = { data: undefined, isPending: false, isLoading: false, error: null };
  harness.refetch.mockReset();
});

afterEach(() => cleanup());

describe("the all-teams page reading team activity", () => {
  describe("given the team activity read fails", () => {
    /** @scenario "A failed team activity read shows only the failure" */
    it("shows the alert and no empty state, no table and no team count", () => {
      harness.teams = {
        data: undefined,
        isPending: false,
        isLoading: false,
        error: new Error("read failed"),
      };
      renderPage();

      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load team activity");
      expect(screen.queryByText("Team activity could not be read.")).toBeNull();
      expect(screen.queryByText("No team activity this window.")).toBeNull();
      expect(screen.queryByText(/teams? shown/)).toBeNull();
    });

    /** @scenario "A failed team activity read shows only the failure" */
    it("reads the team activity again when Try again is pressed", async () => {
      harness.teams = {
        data: undefined,
        isPending: false,
        isLoading: false,
        error: new Error("read failed"),
      };
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(harness.refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("given teams were read and a later refresh fails", () => {
    /** @scenario "A failed refresh keeps the teams already shown beside the alert" */
    it("keeps the teams it already had and shows the alert above them", () => {
      harness.teams = {
        data: [TEAM],
        isPending: false,
        isLoading: false,
        error: new Error("refresh failed"),
      };
      renderPage();

      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load team activity");
      expect(screen.getByText("Platform")).toBeInTheDocument();
      expect(screen.getByText("1 team shown.")).toBeInTheDocument();
    });
  });

  describe("given the read has not answered, or its query is not running yet", () => {
    /** @scenario "A read still in flight claims neither teams nor an empty window" */
    it("shows that it is loading and says nothing about the window", () => {
      // A query disabled until the organization resolves is pending, not loading.
      harness.teams = { data: undefined, isPending: true, isLoading: false, error: null };
      renderPage();

      expect(screen.getByText("Loading teams")).toBeInTheDocument();
      expect(screen.queryByText("No team activity this window.")).toBeNull();
      expect(screen.queryByText(/teams? shown/)).toBeNull();
    });
  });

  describe("given the read answers with no teams", () => {
    /** @scenario "A window with no team activity says so" */
    it("says there was no team activity this window", () => {
      harness.teams = { data: [], isPending: false, isLoading: false, error: null };
      renderPage();

      expect(screen.getByText("No team activity this window.")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
