/**
 * @vitest-environment jsdom
 *
 * The two project-scope coding-agent screens: they hand the table the project
 * the address is on rather than a personal workspace, and they say nothing
 * about a project they have not resolved yet.
 *
 * THE RELEASE FLAG IS NOT ASSERTED HERE ANY MORE. It moved out of the page body
 * and into the route map that mounts these screens, where `apps/ui`'s own
 * page-policy suite covers it; a screen that guarded itself would be stating
 * the policy twice.
 *
 * @see specs/coding-agent/project-menu-links.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  project: undefined as { id: string; name: string; slug: string; teamId: string } | undefined,
  isResolved: true,
  sessionsProps: [] as unknown[],
  pullRequestsProps: [] as unknown[],
}));

vi.mock("@langwatch/coding-agent-web/activity", () => ({
  SessionsTable: (props: unknown) => {
    state.sessionsProps.push(props);
    return <div data-testid="sessions-table" />;
  },
  PullRequestsTable: (props: unknown) => {
    state.pullRequestsProps.push(props);
    return <div data-testid="pull-requests-table" />;
  },
  CodingAgentActivityHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CodingAgentActivityHostPort: class {},
  codingAgentApi: {},
}));

import ProjectPullRequestsPage from "../screens/personal-workspace/project-pull-requests.screen";
import ProjectSessionsPage from "../screens/personal-workspace/project-sessions.screen";
import { fakePersonalWorkspaceHost, personalWorkspaceHostWrapper } from "../testing";

const Wrapper = ({ children }: { children: React.ReactNode }) =>
  personalWorkspaceHostWrapper(
    fakePersonalWorkspaceHost({
      project: state.project ?? null,
      isScopeResolved: state.isResolved,
    }),
  )({ children });

describe("project coding-agent pages", () => {
  beforeEach(() => {
    state.project = { id: "project-1", name: "Demo", slug: "demo", teamId: "team-1" };
    state.isResolved = true;
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

  describe("given the workspace is still resolving", () => {
    beforeEach(() => {
      state.project = undefined;
      state.isResolved = false;
    });

    // Saying "no sessions" before the project resolves states a fact that is
    // not known to be true.
    /** @scenario "Neither page claims anything while the workspace is still resolving" */
    it("waits rather than claiming the project recorded nothing", () => {
      const { container } = render(<ProjectSessionsPage />, { wrapper: Wrapper });

      expect(container.querySelector('[class*="skeleton"], [data-part="root"]')).toBeTruthy();
      expect(screen.queryByTestId("sessions-table")).toBeNull();
      expect(screen.queryByText("No sessions yet")).toBeNull();
    });
  });
});
