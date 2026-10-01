// @vitest-environment jsdom
/**
 * Project's lent switcher, as main's `ProjectSelector` drew it beside Add Secret.
 * The graph arrives already narrowed (ARCHITECTURE §10), so it lists what arrives.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  UiCapabilityContextProvider,
  UiScope,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const project = (id: string, name: string) => ({ id, name, slug: name.toLowerCase() });

const GRAPH = [
  {
    id: "org-1",
    name: "Acme",
    teams: [
      {
        id: "team-1",
        name: "Platform",
        projects: [project("proj-web", "Web"), project("proj-api", "Api")],
      },
      { id: "team-2", name: "Acme", projects: [project("proj-docs", "Docs")] },
    ],
  },
];

vi.mock("../../../behavior/project-api.ts", () => ({
  api: { organization: { getScopeGraph: { useQuery: () => ({ data: GRAPH }) } } },
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

function renderSwitcher({ projectId, pathname }: { projectId: string | null; pathname: string }) {
  const visited: string[] = [];
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {}, pathname }),
      navigate: (to) => visited.push(to),
    }),
    scope: new TestScope({ organizationId: "org-1", projectId }),
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={capabilities}>
        <ProjectSwitcher />
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
  return { visited };
}

afterEach(cleanup);

describe("given the secrets page with a project in scope", () => {
  describe("when it renders", () => {
    it("names the current project on its trigger", () => {
      renderSwitcher({ projectId: "proj-web", pathname: "/settings/secrets" });

      expect(screen.getByRole("button", { name: /Web/ })).toBeInTheDocument();
    });
  });

  describe("when the reader opens it", () => {
    beforeEach(async () => {
      const user = userEvent.setup();
      renderSwitcher({ projectId: "proj-web", pathname: "/settings/secrets" });
      await user.click(screen.getByRole("button", { name: /Web/ }));
    });

    it("lists every project that arrived, grouped by organization and team", async () => {
      expect(await screen.findByText("Acme - Platform")).toBeInTheDocument();
      expect(screen.getByText("Acme")).toBeInTheDocument();
      // The name, without the avatar's initial drawn beside it.
      const names = screen
        .getAllByRole("menuitem")
        .map((item) => item.querySelector("p")?.textContent);
      expect(names).toEqual(["Api", "Web", "Docs"]);
    });

    it("links each project to its home, told to return to the secrets page", async () => {
      const docs = await screen.findByRole("menuitem", { name: /Docs/ });
      expect(docs).toHaveAttribute("href", "/docs?return_to=%2Fsettings%2Fsecrets");
    });
  });

  describe("when the reader picks another project", () => {
    it("navigates in place rather than reloading the page", async () => {
      const user = userEvent.setup();
      const { visited } = renderSwitcher({ projectId: "proj-web", pathname: "/settings/secrets" });

      await user.click(screen.getByRole("button", { name: /Web/ }));
      await user.click(await screen.findByRole("menuitem", { name: /Api/ }));

      expect(visited).toEqual(["/api?return_to=%2Fsettings%2Fsecrets"]);
    });
  });
});

describe("given no project in scope", () => {
  it("draws nothing", () => {
    renderSwitcher({ projectId: null, pathname: "/settings/secrets" });

    expect(screen.queryByRole("button")).toBeNull();
  });
});
