/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { organizationWeb } from "../organization.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs organization", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([organizationWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(organizationWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the Audit Log component", async () => {
      const screen = organizationWeb.installation.screens["pages/settings/audit-log"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the Directory component", async () => {
      const screen = organizationWeb.installation.screens["pages/settings/directory"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    /** Main presents it inside the settings chrome, so organization declares it. */
    it("answers with the Authentication settings component", async () => {
      const screen = organizationWeb.installation.screens["pages/settings/authentication"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    /** Members, Groups and Teams became the Directory's tabs; their addresses redirect. */
    it("declares no page for the retired addresses", () => {
      const screens = organizationWeb.installation.screens;

      expect(screens).not.toHaveProperty("pages/settings/members");
      expect(screens).not.toHaveProperty("pages/settings/groups");
      expect(screens).not.toHaveProperty("pages/settings/teams");
    });

    /** @scenario "The team settings page is declared inside the settings shell" */
    it("places the Team Detail screen within settings, at the team address", () => {
      const screen = organizationWeb.installation.screens["pages/settings/teams/[team]"];

      expect(screen).toMatchObject({ path: "/settings/teams/:team", within: "settings" });
    });

    it("answers with the Team Detail component", async () => {
      const screen = organizationWeb.installation.screens["pages/settings/teams/[team]"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
