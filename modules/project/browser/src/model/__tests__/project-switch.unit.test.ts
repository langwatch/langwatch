import { describe, expect, it } from "vitest";

import { projectSwitchGroups, projectSwitchHref, safeReturnToPath } from "../project-switch.ts";

const project = (name: string) => ({ id: `id-${name}`, name, slug: name.toLowerCase() });

describe("projectSwitchGroups", () => {
  describe("given organizations and teams in no particular order", () => {
    it("groups per team, organizations and projects by name, as the graph arrived", () => {
      const groups = projectSwitchGroups([
        {
          id: "org-b",
          name: "beta",
          teams: [{ id: "team-b", name: "beta", projects: [project("Zed"), project("alpha")] }],
        },
        {
          id: "org-a",
          name: "Acme",
          teams: [{ id: "team-a", name: "Platform", projects: [project("Web")] }],
        },
      ]);

      expect(groups.map(({ key, title }) => ({ key, title }))).toEqual([
        { key: "team-a", title: "Acme - Platform" },
        { key: "team-b", title: "beta" },
      ]);
      expect(groups[1]?.projects.map((entry) => entry.name)).toEqual(["alpha", "Zed"]);
    });
  });
});

describe("projectSwitchGroups within one organization", () => {
  /** @scenario "A settings page shows the top bar's searchable project picker" */
  it("titles each group by its team alone, as the top bar does", () => {
    const groups = projectSwitchGroups([
      {
        id: "org-a",
        name: "Acme",
        teams: [
          { id: "team-a", name: "Platform", projects: [project("Web")] },
          { id: "team-b", name: "Growth", projects: [project("Leads")] },
        ],
      },
    ]);

    expect(groups.map((group) => group.title)).toEqual(["Platform", "Growth"]);
  });

  it("leaves out a team with no project", () => {
    const groups = projectSwitchGroups([
      {
        id: "org-a",
        name: "Acme",
        teams: [
          { id: "team-a", name: "Platform", projects: [project("Web")] },
          { id: "team-empty", name: "Empty", projects: [] },
        ],
      },
    ]);

    expect(groups.map((group) => group.key)).toEqual(["team-a"]);
  });
});

describe("projectSwitchGroups across organizations", () => {
  it("lists the active organization's teams first, the rest by name", () => {
    const organization = (id: string, name: string) => ({
      id,
      name,
      teams: [{ id: `team-${id}`, name: "Core", projects: [project(name)] }],
    });
    const groups = projectSwitchGroups(
      [organization("org-a", "Acme"), organization("org-z", "Zeta"), organization("org-b", "Beta")],
      { organizationId: "org-z" },
    );

    expect(groups.map((group) => group.title)).toEqual([
      "Zeta - Core",
      "Acme - Core",
      "Beta - Core",
    ]);
  });
});

describe("projectSwitchGroups with personal workspaces", () => {
  const graph = [
    {
      id: "org-a",
      name: "Acme",
      teams: [
        {
          id: "mine",
          name: "Mine",
          isPersonal: true,
          ownerUserId: "user-1",
          projects: [project("A")],
        },
        {
          id: "theirs",
          name: "Theirs",
          isPersonal: true,
          ownerUserId: "user-2",
          projects: [project("B")],
        },
      ],
    },
  ];

  /** @scenario "A colleague's personal workspace stays out of the list" */
  it("lists the reader's own personal workspace and not a colleague's", () => {
    expect(projectSwitchGroups(graph, { userId: "user-1" }).map((group) => group.key)).toEqual([
      "mine",
    ]);
  });

  it("lists no personal workspace while the reader is unknown", () => {
    expect(projectSwitchGroups(graph)).toEqual([]);
  });
});

describe("projectSwitchHref", () => {
  describe("when the address names the current project", () => {
    it("keeps the page, under the new project", () => {
      expect(
        projectSwitchHref({
          pathname: "/web/messages",
          currentProjectSlug: "web",
          targetSlug: "api",
        }),
      ).toBe("/api/messages");
    });
  });

  describe("when the page lives outside the project's addresses", () => {
    it("goes to the new project's home, told to return here", () => {
      expect(
        projectSwitchHref({
          pathname: "/settings/secrets",
          currentProjectSlug: "web",
          targetSlug: "api",
        }),
      ).toBe("/api?return_to=%2Fsettings%2Fsecrets");
    });

    it("keeps the page's query, so a consent request survives the round trip", () => {
      const href = projectSwitchHref({
        pathname: "/mcp/authorize",
        query: { client_id: "client-1", redirect_uri: "https://app.example/cb", state: "s" },
        currentProjectSlug: "web",
        targetSlug: "api",
      });

      const returnTo = new URL(href, "https://langwatch.test").searchParams.get("return_to");
      expect(returnTo).toBe(
        "/mcp/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&state=s",
      );
      expect(safeReturnToPath(returnTo ?? void 0)).toBe(returnTo);
    });
  });

  describe("when there is no page to return to", () => {
    it("goes to the new project's home", () => {
      expect(
        projectSwitchHref({ pathname: "", currentProjectSlug: void 0, targetSlug: "api" }),
      ).toBe("/api");
    });
  });
});

describe("safeReturnToPath", () => {
  it("keeps a rooted path on this site", () => {
    expect(safeReturnToPath("/settings/secrets?tab=1")).toBe("/settings/secrets?tab=1");
  });

  it.each([
    ["a scheme-relative address", "//evil.example"],
    ["an absolute URL", "https://evil.example"],
    ["a relative path", "settings"],
    ["a path carrying a newline", "/settings\nSet-Cookie: x"],
    ["nothing", undefined],
  ])("refuses %s", (_label, value) => {
    expect(safeReturnToPath(value)).toBeUndefined();
  });
});
