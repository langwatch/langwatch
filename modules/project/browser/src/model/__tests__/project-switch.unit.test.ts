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
