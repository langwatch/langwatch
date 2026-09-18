/**
 * @vitest-environment jsdom
 * `UiProjectSwitcher` wires the combobox's `onCreateProjectForTeam` to the
 * `createProject` drawer; the popup's own interaction is navigation-web's.
 */

import { WithStubNavigationHost } from "@langwatch/navigation-browser/testing";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openDrawerMock = vi.fn();
const capturedProps: {
  onCreateProjectForTeam?: (args: { teamId: string; orgId: string }) => void;
} = {};

vi.mock("@langwatch/browser-host/drawer", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/browser-host/drawer")>(
    "@langwatch/browser-host/drawer",
  );
  return {
    ...actual,
    useDrawer: () => ({ openDrawer: openDrawerMock, closeDrawer: () => {} }),
  };
});

vi.mock("@langwatch/navigation-browser/chrome", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/navigation-browser/chrome")>(
    "@langwatch/navigation-browser/chrome",
  );
  return {
    ...actual,
    ProjectSwitcherCombobox: (props: typeof capturedProps) => {
      capturedProps.onCreateProjectForTeam = props.onCreateProjectForTeam;
      return null;
    },
  };
});

import { UiProjectSwitcher } from "../ui-project-switcher";

const teamWithNoProjects = {
  id: "team_new",
  name: "New Team",
  isPersonal: false,
  ownerUserId: null,
  members: [],
  projects: [],
};

afterEach(() => {
  cleanup();
  openDrawerMock.mockClear();
});

describe("given a team a coding-usage signup can create a project on", () => {
  /** @scenario A coding-usage signup can always create their first shared project from the workspace menu */
  it("opens the createProject drawer scoped to that team when the popup asks to create", () => {
    render(
      <WithStubNavigationHost
        readings={{
          project: { id: "project_1", slug: "demo", name: "Demo" },
          organization: { id: "org_1", name: "Acme", teams: [] },
          organizations: [{ id: "org_1", name: "Acme", teams: [] }],
          openableTeams: [teamWithNoProjects],
          pathname: "/demo",
          permissions: ["project:create"],
        }}
      >
        <UiProjectSwitcher />
      </WithStubNavigationHost>,
    );

    capturedProps.onCreateProjectForTeam?.({ teamId: "team_new", orgId: "org_1" });

    expect(openDrawerMock).toHaveBeenCalledWith("createProject", { defaultTeamId: "team_new" });
  });
});
