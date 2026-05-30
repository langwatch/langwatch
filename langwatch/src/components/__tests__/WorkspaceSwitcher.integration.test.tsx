/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceSwitcher,
  type WorkspaceSwitcherProps,
} from "../WorkspaceSwitcher";

const mockPush = vi.fn();
let mockPathname = "/";
let mockProject: { id: string; slug: string } | null = null;

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    asPath: mockPathname,
    pathname: mockPathname,
    push: mockPush,
    replace: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: mockProject }),
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
  orgId: "org_acme",
  orgName: "Acme",
  orgSlug: "acme",
  href: "/settings/teams/team-a",
  label: "Acme Engineering",
};

const projectFoo = {
  kind: "project" as const,
  projectId: "project_foo",
  projectSlug: "project-foo",
  teamId: "team_a",
  orgId: "org_acme",
  orgName: "Acme",
  orgSlug: "acme",
  href: "/project-foo",
  label: "Foo Project",
};

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockPathname = "/";
    mockProject = null;
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

  describe("given a team the user can create projects in", () => {
    /** @scenario The dropdown shows a per-team "Create project" button (admin-only) */
    it("renders a + button that opens the create-project drawer scoped to that team", async () => {
      const user = userEvent.setup();
      const onCreateProjectForTeam = vi.fn();
      renderSwitcher({
        personal,
        teams: [{ ...teamA, canCreateProject: true }],
        projects: [projectFoo],
        current: { kind: "personal" },
        onCreateProjectForTeam,
      });

      await user.click(
        screen.getByRole("button", { name: /switch workspace/i }),
      );
      const addButton = await screen.findByRole("button", {
        name: /create project in acme engineering/i,
      });
      await user.click(addButton);

      expect(onCreateProjectForTeam).toHaveBeenCalledWith({
        teamId: "team_a",
        orgId: "org_acme",
      });
    });

    /** @scenario The "Create project" button is suppressed for non-admin members */
    it("hides the + button when the user cannot create projects in the team", async () => {
      const user = userEvent.setup();
      renderSwitcher({
        personal,
        teams: [{ ...teamA, canCreateProject: false }],
        projects: [projectFoo],
        current: { kind: "personal" },
        onCreateProjectForTeam: vi.fn(),
      });

      await user.click(
        screen.getByRole("button", { name: /switch workspace/i }),
      );
      expect(await screen.findByText("Acme Engineering")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /create project in/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("personal entry governance gate", () => {
    /** @scenario The personal entry is hidden when no organization enables governance */
    it("does not render the My Workspace entry when personal is omitted", async () => {
      const user = userEvent.setup();
      renderSwitcher({
        teams: [teamA],
        projects: [projectFoo],
        current: { kind: "team", teamId: "team_a" },
      });

      await user.click(
        screen.getByRole("button", { name: /switch workspace/i }),
      );
      // "Foo Project" is unique to the open dropdown (the trigger shows the
      // current team), so finding it confirms the menu opened.
      expect(await screen.findByText("Foo Project")).toBeInTheDocument();
      expect(screen.queryByText("My Workspace")).not.toBeInTheDocument();
    });

    /** @scenario The personal entry shows when any organization enables governance */
    it("renders the My Workspace entry when personal is provided", async () => {
      const user = userEvent.setup();
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [projectFoo],
        current: { kind: "team", teamId: "team_a" },
      });

      await user.click(
        screen.getByRole("button", { name: /switch workspace/i }),
      );
      expect(
        (await screen.findAllByText("My Workspace")).length,
      ).toBeGreaterThan(0);
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

  // -------------------------------------------------------------------
  // Auto-detected current context (no `current` prop passed)
  // Spec: specs/ai-gateway/governance/workspace-switcher.feature
  //       (scenarios under "Auto-detected current context from URL")
  // -------------------------------------------------------------------

  describe("when `current` is not passed and the route is /me", () => {
    it("auto-detects personal as the current context", () => {
      mockPathname = "/me";
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [projectFoo],
      });

      expect(screen.getByText("My Workspace")).toBeInTheDocument();
    });
  });

  describe("when `current` is not passed and the route is /me/configure", () => {
    it("still auto-detects personal", () => {
      mockPathname = "/me/configure";
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [projectFoo],
      });

      expect(screen.getByText("My Workspace")).toBeInTheDocument();
    });
  });

  describe("when `current` is not passed and the route is a team settings page", () => {
    it("auto-detects the team via slug match", () => {
      mockPathname = "/settings/teams/team-a";
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [],
      });

      expect(screen.getByText("Acme Engineering")).toBeInTheDocument();
    });
  });

  describe("when `current` is not passed and the resolved project matches a switcher entry", () => {
    it("auto-detects the project from the OTP hook", () => {
      mockPathname = "/project-foo";
      mockProject = { id: "project_foo", slug: "project-foo" };
      renderSwitcher({
        personal,
        teams: [],
        projects: [projectFoo],
      });

      expect(screen.getByText("Foo Project")).toBeInTheDocument();
    });
  });

  describe("when `current` is not passed and the route doesn't match any context", () => {
    it("falls back to 'Choose workspace'", () => {
      mockPathname = "/settings/billing";
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [projectFoo],
      });

      expect(screen.getByText(/choose workspace/i)).toBeInTheDocument();
    });
  });

  describe("when an explicit `current` prop is passed", () => {
    it("overrides auto-detection from the URL", () => {
      mockPathname = "/me"; // would auto-detect personal
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [],
        current: { kind: "team", teamId: "team_a" },
      });

      // Trigger shows the team label (override won), not "My Workspace"
      expect(screen.getByText("Acme Engineering")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // Multi-org disambiguation: a user belonging to two orgs that each
  // have a "Default Team" should see them grouped under their org name,
  // not as visually-identical adjacent rows.
  // Spec: specs/ai-gateway/governance/workspace-switcher.feature
  //       (scenarios under "Multi-org disambiguation")
  // -------------------------------------------------------------------

  describe("when a user belongs to multiple orgs", () => {
    const teamAcmeDefault = {
      kind: "team" as const,
      teamId: "team_acme_default",
      teamSlug: "acme-default",
      orgId: "org_acme",
      orgName: "Acme",
      orgSlug: "acme",
      href: "/settings/teams/acme-default",
      label: "Default Team",
    };
    const teamGlobexDefault = {
      kind: "team" as const,
      teamId: "team_globex_default",
      teamSlug: "globex-default",
      orgId: "org_globex",
      orgName: "Globex",
      orgSlug: "globex",
      href: "/settings/teams/globex-default",
      label: "Default Team",
    };
    const projectAcme = {
      kind: "project" as const,
      projectId: "project_acme",
      projectSlug: "acme-project",
      teamId: "team_acme_default",
      orgId: "org_acme",
      orgName: "Acme",
      orgSlug: "acme",
      href: "/acme-project",
      label: "Acme Project",
    };
    const projectGlobex = {
      kind: "project" as const,
      projectId: "project_globex",
      projectSlug: "globex-project",
      teamId: "team_globex_default",
      orgId: "org_globex",
      orgName: "Globex",
      orgSlug: "globex",
      href: "/globex-project",
      label: "Globex Project",
    };

    it("groups teams under their org name as section headers", async () => {
      const user = userEvent.setup();
      renderSwitcher({
        personal,
        teams: [teamAcmeDefault, teamGlobexDefault],
        projects: [projectAcme, projectGlobex],
        current: { kind: "personal" },
      });

      // Chakra v3 Menu (Ark) needs the full pointer chain to open in jsdom;
      // native Element.click() leaves it data-state="closed".
      await user.click(
        screen.getByRole("button", { name: /switch workspace/i }),
      );

      // Both org names render as section headers, disambiguating the
      // identical "Default Team" rows that would otherwise look duplicated.
      expect(await screen.findByText("Acme")).toBeInTheDocument();
      expect(screen.getByText("Globex")).toBeInTheDocument();
    });

    it("does NOT render the generic 'Teams & projects' header in multi-org mode", async () => {
      const user = userEvent.setup();
      renderSwitcher({
        personal,
        teams: [teamAcmeDefault, teamGlobexDefault],
        projects: [projectAcme, projectGlobex],
        current: { kind: "personal" },
      });

      await user.click(
        screen.getByRole("button", { name: /switch workspace/i }),
      );

      // The generic header is only used in single-org mode; with multiple
      // orgs each org name is its own header. Wait for an org header to
      // confirm the menu opened before asserting absence of the generic.
      await screen.findByText("Acme");
      expect(screen.queryByText("Teams & projects")).not.toBeInTheDocument();
    });

    it("disambiguates same-name orgs by appending the slug to the header", async () => {
      const teamAcmeAlt = {
        ...teamAcmeDefault,
        teamId: "team_acme_alt",
        teamSlug: "acme-alt",
        orgId: "org_acme_2",
        orgName: "Acme",
        orgSlug: "acme-2",
      };
      const projectAcmeAlt = {
        ...projectAcme,
        projectId: "project_acme_alt",
        teamId: "team_acme_alt",
        orgId: "org_acme_2",
        orgName: "Acme",
        orgSlug: "acme-2",
        label: "Acme Alt Project",
      };
      renderSwitcher({
        personal,
        teams: [teamAcmeDefault, teamAcmeAlt],
        projects: [projectAcme, projectAcmeAlt],
        current: { kind: "personal" },
      });

      const user = userEvent.setup();
      await user.click(
        screen.getByRole("button", { name: /switch workspace/i }),
      );

      // Two orgs both named "Acme" should be distinguishable in the dropdown.
      expect(await screen.findByText("Acme · acme")).toBeInTheDocument();
      expect(screen.getByText("Acme · acme-2")).toBeInTheDocument();
    });
  });

  describe("when a user belongs to a single org", () => {
    it("renders no section header — org context is implicit when there is only one", () => {
      renderSwitcher({
        personal,
        teams: [teamA],
        projects: [projectFoo],
        current: { kind: "personal" },
      });

      screen.getByRole("button", { name: /switch workspace/i }).click();

      expect(screen.queryByText("Teams & projects")).not.toBeInTheDocument();
      expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    });
  });
});
