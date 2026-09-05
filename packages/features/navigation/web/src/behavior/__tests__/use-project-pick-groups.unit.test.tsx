/**
 * @vitest-environment jsdom
 * The per-team "New Project" affordance, kept even for an empty team.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { NavigationHostProvider } from "../../model/navigation-host";
import { StubNavigationHost } from "../../testing";
import { useProjectPickGroups } from "../use-project-pick-groups";

const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };

const teamWithProject = {
  id: "team_a",
  name: "Acme Engineering",
  isPersonal: false,
  ownerUserId: null,
  members: [],
  projects: [{ id: "project_1", slug: "demo", name: "Demo", isPersonal: false }],
};

const emptyTeam = {
  id: "team_empty",
  name: "New Team",
  isPersonal: false,
  ownerUserId: null,
  members: [],
  projects: [],
};

function wrapperFor(host: StubNavigationHost) {
  return ({ children }: { children: ReactNode }) => (
    <NavigationHostProvider value={host}>{children}</NavigationHostProvider>
  );
}

function renderGroups(host: StubNavigationHost) {
  return renderHook(() => useProjectPickGroups(), { wrapper: wrapperFor(host) }).result;
}

describe("given a reader who may create projects", () => {
  /** @scenario The dropdown shows a per-team "Create project" button (admin-only) */
  it("marks every team's group canCreateProject", () => {
    const host = StubNavigationHost.create({
      organization: ORGANIZATION,
      organizations: [ORGANIZATION],
      openableTeams: [teamWithProject],
      permissions: ["project:create"],
    });

    const result = renderGroups(host);

    expect(result.current[0]?.team.canCreateProject).toBe(true);
  });

  /** @scenario A coding-usage signup can always create their first shared project from the workspace menu */
  it("keeps an empty team's group so its first project can be created", () => {
    const host = StubNavigationHost.create({
      organization: ORGANIZATION,
      organizations: [ORGANIZATION],
      openableTeams: [emptyTeam],
      permissions: ["project:create"],
    });

    const result = renderGroups(host);

    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.team.teamId).toBe("team_empty");
    expect(result.current[0]?.projects).toEqual([]);
  });
});

describe("given a reader who may not create projects", () => {
  /** @scenario The "Create project" button is suppressed for non-admin members */
  it("marks every team's group canCreateProject false", () => {
    const host = StubNavigationHost.create({
      organization: ORGANIZATION,
      organizations: [ORGANIZATION],
      openableTeams: [teamWithProject],
      permissions: [],
    });

    const result = renderGroups(host);

    expect(result.current[0]?.team.canCreateProject).toBe(false);
  });

  /** @scenario An empty team stays hidden from members who cannot create a project on it */
  it("drops an empty team's group entirely", () => {
    const host = StubNavigationHost.create({
      organization: ORGANIZATION,
      organizations: [ORGANIZATION],
      openableTeams: [emptyTeam],
      permissions: [],
    });

    const result = renderGroups(host);

    expect(result.current).toEqual([]);
  });
});
