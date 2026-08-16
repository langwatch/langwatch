/**
 * @vitest-environment jsdom
 *
 * The two project-scope coding-agent pages: they open behind the release flag,
 * and they hand the table the project the rail is on rather than a personal
 * workspace.
 *
 * @see specs/coding-agent/project-menu-links.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  project: undefined as { id: string; slug: string } | undefined,
  isLoading: false,
  flagEnabled: true,
  sessionsProps: [] as unknown[],
  pullRequestsProps: [] as unknown[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: state.project,
    organization: { id: "organization-1" },
    isLoading: state.isLoading,
    hasPermission: () => true,
    isPublicRoute: false,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: state.flagEnabled, isLoading: false }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>Loading</div>,
}));

vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>Not found</div>,
}));

vi.mock("~/components/me/SessionsTable", () => ({
  SessionsTable: (props: unknown) => {
    state.sessionsProps.push(props);
    return <div data-testid="sessions-table" />;
  },
}));

vi.mock("~/components/me/PullRequestsTable", () => ({
  PullRequestsTable: (props: unknown) => {
    state.pullRequestsProps.push(props);
    return <div data-testid="pull-requests-table" />;
  },
}));

import ProjectPullRequestsPage from "../pull-requests";
import ProjectSessionsPage from "../sessions";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("project coding-agent pages", () => {
  beforeEach(() => {
    state.project = { id: "project-1", slug: "demo" };
    state.isLoading = false;
    state.flagEnabled = true;
    state.sessionsProps = [];
    state.pullRequestsProps = [];
  });

  afterEach(cleanup);

  describe("given a project the viewer opened", () => {
    /** @scenario "Opening the Sessions destination shows this project's sessions" */
    it("shows the project's sessions", () => {
      render(<ProjectSessionsPage />, { wrapper: Wrapper });

      expect(screen.getByText("Sessions")).toBeTruthy();
      expect(screen.getByTestId("sessions-table")).toBeTruthy();
      expect(state.sessionsProps[0]).toEqual({
        projectId: "project-1",
        projectSlug: "demo",
      });
    });

    /** @scenario "Opening the Pull requests destination shows this project's pull requests" */
    it("shows the project's pull requests", () => {
      render(<ProjectPullRequestsPage />, { wrapper: Wrapper });

      expect(screen.getByText("Pull requests")).toBeTruthy();
      expect(screen.getByTestId("pull-requests-table")).toBeTruthy();
      expect(state.pullRequestsProps[0]).toEqual({ projectId: "project-1" });
    });
  });

  describe("given the coding-agent pages are not released for the organization", () => {
    beforeEach(() => {
      state.flagEnabled = false;
    });

    /** @scenario "The pages stay closed when they are not released" */
    it("does not open the Sessions page", () => {
      render(<ProjectSessionsPage />, { wrapper: Wrapper });

      expect(screen.queryByTestId("sessions-table")).toBeNull();
      expect(screen.getByText("Not found")).toBeTruthy();
    });

    /** @scenario "The pages stay closed when they are not released" */
    it("does not open the Pull requests page", () => {
      render(<ProjectPullRequestsPage />, { wrapper: Wrapper });

      expect(screen.queryByTestId("pull-requests-table")).toBeNull();
      expect(screen.getByText("Not found")).toBeTruthy();
    });
  });

  describe("while the workspace is still resolving", () => {
    beforeEach(() => {
      state.project = undefined;
      state.isLoading = true;
    });

    // Saying "no sessions" before the project resolves states a fact that is
    // not known to be true, and flashing a 404 while the flag is unresolved
    // says something worse.
    /** @scenario "Neither page claims anything while the workspace is still resolving" */
    it("waits rather than claiming the project recorded nothing", () => {
      render(<ProjectSessionsPage />, { wrapper: Wrapper });

      expect(screen.getByText("Loading")).toBeTruthy();
      expect(screen.queryByText("No sessions yet")).toBeNull();
      expect(screen.queryByText("Not found")).toBeNull();
    });
  });
});
