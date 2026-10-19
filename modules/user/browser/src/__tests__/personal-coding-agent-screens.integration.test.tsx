/**
 * @vitest-environment jsdom
 * The personal Sessions and Pull requests pages hand the resolved personal
 * project to coding-agent's tables, whose empty states ("No sessions recorded
 * yet", "GitHub is not connected") are theirs. Ref: specs/coding-agent/sessions-screen.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ready: true,
  isPersonalProjectResolved: true,
  personalProjectId: null as string | null,
  personalProjectSlug: null as string | null,
  sessionsProps: [] as unknown[],
  pullRequestsProps: [] as unknown[],
}));

vi.mock("../behavior/use-personal-context.ts", () => ({
  usePersonalContext: () => state,
}));
vi.mock("../ui/sections/personal-workspace-layout.tsx", () => ({
  PersonalWorkspaceLayout: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../behavior/lent-coding-agent-tables.tsx", () => ({
  CodingAgentSessionsTable: (props: unknown) => {
    state.sessionsProps.push(props);
    return <div data-testid="sessions-table" />;
  },
  CodingAgentPullRequestsTable: (props: unknown) => {
    state.pullRequestsProps.push(props);
    return <div data-testid="pull-requests-table" />;
  },
}));

import { fakePersonalWorkspaceHost, personalWorkspaceHostWrapper } from "../testing.tsx";
import { PersonalPullRequestsScreen } from "../ui/sections/personal-workspace/personal-pull-requests.screen.tsx";
import { PersonalSessionsScreen } from "../ui/sections/personal-workspace/personal-sessions.screen.tsx";

const Wrapper = personalWorkspaceHostWrapper(fakePersonalWorkspaceHost());

describe("personal coding-agent pages", () => {
  beforeEach(() => {
    state.ready = true;
    state.isPersonalProjectResolved = true;
    state.personalProjectId = "project-me";
    state.personalProjectSlug = "me";
    state.sessionsProps = [];
    state.pullRequestsProps = [];
  });

  afterEach(cleanup);

  describe("given the personal workspace resolved", () => {
    it("hands the personal project to the sessions table", () => {
      render(<PersonalSessionsScreen />, { wrapper: Wrapper });

      expect(screen.getByTestId("sessions-table")).toBeTruthy();
      expect(state.sessionsProps[0]).toEqual({ projectId: "project-me", projectSlug: "me" });
    });

    it("hands the personal project to the pull requests table", () => {
      render(<PersonalPullRequestsScreen />, { wrapper: Wrapper });

      expect(screen.getByTestId("pull-requests-table")).toBeTruthy();
      expect(state.pullRequestsProps[0]).toEqual({ projectId: "project-me" });
      expect(screen.queryByText("No pull requests yet")).toBeNull();
    });
  });

  describe("given the personal workspace is still resolving", () => {
    it("waits rather than claiming no sessions were recorded", () => {
      state.isPersonalProjectResolved = false;
      state.personalProjectId = null;

      render(<PersonalSessionsScreen />, { wrapper: Wrapper });

      expect(screen.queryByTestId("sessions-table")).toBeNull();
      expect(screen.queryByText("No sessions yet")).toBeNull();
    });
  });
});
