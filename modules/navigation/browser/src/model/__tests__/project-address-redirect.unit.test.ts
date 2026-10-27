import { describe, expect, it } from "vitest";

import {
  projectAddressRedirect,
  projectRedirectSubPath,
  type ProjectAddressInput,
} from "../project-address-redirect.ts";

const organization = {
  primaryIntent: null,
  teams: [{ id: "team_1", name: "Core", projects: [{ id: "p1", name: "Mine", slug: "mine" }] }],
};

/** A settled workspace that resolved the address to the project "mine". */
function address(overrides: Partial<ProjectAddressInput>): ProjectAddressInput {
  return {
    projectParam: "mine",
    projectSlugFromAddress: "mine",
    project: { slug: "mine" },
    organization,
    organizations: [organization],
    isLoading: false,
    demoProjectSlug: void 0,
    pathname: "/mine/traces",
    search: "",
    ...overrides,
  };
}

describe("projectAddressRedirect", () => {
  describe("given an address naming a project the reader does not have", () => {
    /** @scenario "An address naming a project I do not have opens the same page in mine" */
    it("keeps the rest of the address and its query", () => {
      const destination = projectAddressRedirect(
        address({
          projectParam: "bad-slug",
          projectSlugFromAddress: "bad-slug",
          pathname: "/bad-slug/traces/abc",
          search: "?view=table",
        }),
      );

      expect(destination).toBe("/mine/traces/abc?view=table");
    });
  });

  describe("given the @project placeholder a mail or a doc link carries", () => {
    /** @scenario "An @project address opens the same page in my project" */
    it("puts the current project in its place", () => {
      const destination = projectAddressRedirect(
        address({
          projectParam: "@project",
          projectSlugFromAddress: "@project",
          pathname: "/@project/traces",
        }),
      );

      expect(destination).toBe("/mine/traces");
    });
  });

  describe("given a reserved word where the project belongs", () => {
    /** @scenario "A page name in the project's place opens that page in my project" */
    it("opens that page in the current project", () => {
      const destination = projectAddressRedirect(
        address({
          projectParam: "analytics",
          projectSlugFromAddress: void 0,
          pathname: "/analytics",
        }),
      );

      expect(destination).toBe("/mine/analytics");
    });
  });

  describe("given an address that already names the reader's project", () => {
    /** @scenario "An address naming my project stays where it is" */
    it("stays", () => {
      expect(projectAddressRedirect(address({}))).toBeNull();
    });
  });

  describe("given a workspace that has not settled", () => {
    /** @scenario "Nothing is redirected while the workspace is still resolving" */
    it("waits rather than redirecting to a project that may not be the answer", () => {
      expect(
        projectAddressRedirect(
          address({
            projectParam: "bad-slug",
            projectSlugFromAddress: "bad-slug",
            isLoading: true,
          }),
        ),
      ).toBeNull();
    });
  });

  describe("given an organization that declared what it is for", () => {
    /** @scenario "An organization that declared its intent is not sent to a project" */
    it("stays, as main's onboarded-organization rule does", () => {
      const intentSet = { ...organization, primaryIntent: "governance" };

      expect(
        projectAddressRedirect(
          address({
            projectParam: "bad-slug",
            projectSlugFromAddress: "bad-slug",
            organization: intentSet,
            organizations: [intentSet],
          }),
        ),
      ).toBeNull();
    });
  });

  describe("given the deployment's shared demo project", () => {
    /** @scenario "The demo project address stays where it is" */
    it("stays on the demo slug", () => {
      expect(
        projectAddressRedirect(
          address({
            projectParam: "demo",
            projectSlugFromAddress: "demo",
            demoProjectSlug: "demo",
          }),
        ),
      ).toBeNull();
    });
  });
});

describe("projectRedirectSubPath", () => {
  describe("given a project segment the router decoded", () => {
    /** @scenario "An address naming a project I do not have opens the same page in mine" */
    it("matches the encoded form the address keeps", () => {
      expect(projectRedirectSubPath({ pathname: "/a%20b/traces", oldProject: "a b" })).toBe(
        "/traces",
      );
    });
  });

  describe("given a path that only starts with the same letters", () => {
    /** @scenario "An address naming a project I do not have opens the same page in mine" */
    it("keeps nothing rather than a torn segment", () => {
      expect(projectRedirectSubPath({ pathname: "/badger/traces", oldProject: "bad" })).toBe("");
    });
  });
});
