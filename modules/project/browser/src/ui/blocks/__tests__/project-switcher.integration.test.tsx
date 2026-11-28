// @vitest-environment jsdom
/**
 * Project's lent switcher on settings-style pages: the design system's one project
 * picker, the top bar's. Spec: specs/navigation/one-project-picker.feature
 */
import {
  UiHostServicesContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiActor,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const project = (id: string, name: string, kind = "application") => ({
  id,
  name,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  kind,
});
const team = (
  id: string,
  name: string,
  projects: ReturnType<typeof project>[],
  personal?: { ownerUserId: string },
) => ({
  id,
  name,
  isPersonal: !!personal,
  ownerUserId: personal?.ownerUserId ?? null,
  projects,
});

const GRAPH = [
  {
    id: "org-1",
    name: "Acme",
    teams: [
      team("team-1", "Platform", [project("proj-web", "Web"), project("proj-api", "Api")]),
      team("team-2", "Acme", [
        project("proj-docs", "Docs"),
        project("proj-all", "Everything", "aggregate"),
      ]),
      team("team-me", "My workspace", [project("proj-mine", "Mine")], { ownerUserId: "user-1" }),
      team("team-col", "Colleague workspace", [project("proj-theirs", "Theirs")], {
        ownerUserId: "user-2",
      }),
    ],
  },
];

vi.mock("../../../behavior/project-api.ts", () => ({
  projectApi: { organization: { getScopeGraph: { useQuery: () => ({ data: GRAPH }) } } },
}));

import ProjectSwitcher from "../project-switcher.tsx";

class TestScope extends UiScope {
  constructor(private readonly reading: UiActiveScope) {
    super();
  }

  activeScope(): UiActiveScope {
    return this.reading;
  }
}

class SignedInSession extends UiSession {
  currentUser(): UiActor {
    return { id: "user-1", name: null, email: null, image: null };
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }
}

function renderSwitcher({ projectId, pathname }: { projectId: string | null; pathname: string }) {
  const visited: string[] = [];
  const capabilities: UiHostServices = {
    ...createUiHostServicesFromHost(
      {
        route: () => ({ params: {}, query: {}, pathname }),
        navigate: (to) => visited.push(to),
      },
      new SignedInSession(),
    ),
    scope: new TestScope({ organizationId: "org-1", projectId }),
  };
  render(
    <DesignSystemProvider forcedTheme="light">
      <UiHostServicesContextProvider value={capabilities}>
        <ProjectSwitcher />
      </UiHostServicesContextProvider>
    </DesignSystemProvider>,
  );
  return { visited };
}

async function openPicker() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Switch project" }));
  await waitFor(() => {
    expect(screen.getByRole("combobox", { name: "Search projects" })).toHaveFocus();
  });
  return user;
}

// Ark's combobox input is machine-controlled; one change event with the whole query
// is deterministic where per-character typing races the re-render.
function searchFor(text: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Search projects" }), {
    target: { value: text },
  });
}

/** Each option's project name, without the avatar initial drawn beside it. */
function optionNames() {
  return screen
    .getAllByRole("option")
    .map((option) => option.querySelector('[data-part="item-text"]')?.textContent);
}

afterEach(cleanup);

describe("given the project settings page with a project in scope", () => {
  describe("when it renders", () => {
    /** @scenario "A settings page shows the top bar's searchable project picker" */
    it("names the current project on the picker's chip", () => {
      renderSwitcher({ projectId: "proj-web", pathname: "/settings/project" });

      expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("Web");
    });
  });

  describe("when the reader opens it", () => {
    /** @scenario "A settings page shows the top bar's searchable project picker" */
    it("focuses a search field over the projects grouped by team, the current one ticked", async () => {
      renderSwitcher({ projectId: "proj-web", pathname: "/settings/project" });
      await openPicker();

      expect(await screen.findByText("Platform")).toBeInTheDocument();
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(optionNames()).toEqual(["Api", "Web", "Docs", "Everything", "Mine"]);
      const current = screen.getByRole("option", { name: /Web/ });
      expect(within(current).getByLabelText("Current project")).toBeInTheDocument();
    });

    /** @scenario "A colleague's personal workspace stays out of the list" */
    it("lists the reader's own personal workspace but not a colleague's", async () => {
      renderSwitcher({ projectId: "proj-web", pathname: "/settings/project" });
      await openPicker();

      expect(await screen.findByText("Mine")).toBeInTheDocument();
      expect(screen.queryByText("Theirs")).not.toBeInTheDocument();
    });
  });

  describe("when the reader types part of a project name and presses Enter", () => {
    /** @scenario "Typing filters the projects and Enter switches to the first match" */
    it("keeps only the matches and opens the first, told to return to the settings page", async () => {
      const { visited } = renderSwitcher({ projectId: "proj-web", pathname: "/settings/project" });
      await openPicker();

      searchFor("do");
      await waitFor(() => expect(optionNames()).toEqual(["Docs"]));
      const field = screen.getByRole("combobox", { name: "Search projects" });
      await waitFor(() => {
        expect(screen.getByRole("option", { name: /Docs/ })).toHaveAttribute("data-highlighted");
      });
      fireEvent.keyDown(field, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(visited).toEqual(["/docs?return_to=%2Fsettings%2Fproject"]);
      });
    });
  });

  describe("when nothing matches the search", () => {
    /** @scenario "No project matches the search" */
    it("says so in one line and offers nothing to pick", async () => {
      const { visited } = renderSwitcher({ projectId: "proj-web", pathname: "/settings/project" });
      await openPicker();

      searchFor("zzz");
      await waitFor(() => {
        expect(screen.getByText('No projects match "zzz"')).toBeInTheDocument();
      });
      expect(screen.queryAllByRole("option")).toHaveLength(0);
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Search projects" }), {
        key: "Enter",
        code: "Enter",
      });
      expect(visited).toEqual([]);
    });
  });

  describe("when the reader picks the project already in scope", () => {
    it("stays where it is", async () => {
      const { visited } = renderSwitcher({ projectId: "proj-web", pathname: "/settings/project" });
      const user = await openPicker();

      await user.click(screen.getByRole("option", { name: /Web/ }));

      expect(visited).toEqual([]);
    });
  });
});

describe("given a page under the current project's address", () => {
  it("keeps the page under the picked project", async () => {
    const { visited } = renderSwitcher({ projectId: "proj-web", pathname: "/web/messages" });
    const user = await openPicker();

    await user.click(screen.getByRole("option", { name: /Api/ }));

    expect(visited).toEqual(["/api/messages"]);
  });
});

describe("given no project in scope", () => {
  /** @scenario "A page with no project in scope draws no picker" */
  it("draws nothing", () => {
    renderSwitcher({ projectId: null, pathname: "/settings/secrets" });

    expect(screen.queryByRole("button")).toBeNull();
  });
});
