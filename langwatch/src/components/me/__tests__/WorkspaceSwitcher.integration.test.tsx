/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import {
  WorkspaceSwitcher,
  type WorkspaceSwitcherProps,
} from "../WorkspaceSwitcher";

const mockPush = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    asPath: "/",
    push: mockPush,
    replace: vi.fn(),
  }),
}));

function renderSwitcher(props: WorkspaceSwitcherProps) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WorkspaceSwitcher {...props} />
    </ChakraProvider>,
  );
}

const personal = {
  kind: "personal" as const,
  href: "/me",
  label: "My Workspace",
  subtitle: "Personal usage, personal budget",
};

const teamA = {
  kind: "team" as const,
  teamId: "team_a",
  teamSlug: "team-a",
  href: "/settings/teams/team-a",
  label: "Acme Engineering",
  subtitle: "Team I'm part of",
};

const projectFoo = {
  kind: "project" as const,
  projectId: "project_foo",
  projectSlug: "project-foo",
  href: "/project-foo",
  label: "Foo Project",
  subtitle: "Project I work on",
};

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the user has only a personal workspace", () => {
    it("renders the personal label in the trigger", () => {
      renderSwitcher({
        personal,
        teams: [],
        projects: [],
        current: { kind: "personal" },
      });

      expect(screen.getByText("My Workspace")).toBeInTheDocument();
    });

    it("disables the trigger because there is nothing to switch to", () => {
      renderSwitcher({
        personal,
        teams: [],
        projects: [],
        current: { kind: "personal" },
      });

      const trigger = screen.getByRole("button", {
        name: /switch workspace/i,
      });
      expect(trigger).toBeDisabled();
    });
  });

  describe("given the user has a team and a project context available", () => {
    it("enables the trigger", () => {
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [projectFoo],
        current: { kind: "personal" },
      });

      const trigger = screen.getByRole("button", {
        name: /switch workspace/i,
      });
      expect(trigger).not.toBeDisabled();
    });
  });

  describe("given the trigger is rendered for a current team context", () => {
    it("shows the team label in the trigger", () => {
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [],
        current: { kind: "team", teamId: "team_a" },
      });

      expect(screen.getByText("Acme Engineering")).toBeInTheDocument();
    });
  });

  describe("given the trigger is rendered for a current project context", () => {
    it("shows the project label in the trigger", () => {
      renderSwitcher({
        personal,
        teams: [],
        projects: [projectFoo],
        current: { kind: "project", projectId: "project_foo" },
      });

      expect(screen.getByText("Foo Project")).toBeInTheDocument();
    });
  });

  describe("given an unknown current context", () => {
    it("falls back to a 'choose workspace' label", () => {
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [],
        current: { kind: "unknown" },
      });

      expect(screen.getByText(/choose workspace/i)).toBeInTheDocument();
    });
  });

  describe("given a team context whose id is not in the teams array", () => {
    it("uses 'Team' as a graceful fallback in the trigger", () => {
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [],
        current: { kind: "team", teamId: "team_does_not_exist" },
      });

      expect(screen.getByText("Team")).toBeInTheDocument();
    });
  });

  describe("aria semantics", () => {
    it("exposes aria-haspopup=menu on the trigger", () => {
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [],
        current: { kind: "personal" },
      });

      const trigger = screen.getByRole("button", {
        name: /switch workspace/i,
      });
      expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    });

    it("starts with aria-expanded=false", () => {
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [],
        current: { kind: "personal" },
      });

      const trigger = screen.getByRole("button", {
        name: /switch workspace/i,
      });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("includes the current workspace label in the aria-label so a screen reader announces context", () => {
      renderSwitcher({
        personal,
        teams: [],
        projects: [],
        current: { kind: "personal" },
      });

      const trigger = screen.getByRole("button", {
        name: /Switch workspace \(current: My Workspace\)/i,
      });
      expect(trigger).toBeInTheDocument();
    });
  });
});
