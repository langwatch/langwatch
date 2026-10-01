/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { onboardingWeb } from "../onboarding.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs onboarding", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([onboardingWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(onboardingWeb);
    });
  });

  describe("when the guided-onboarding host mount is asked for", () => {
    it("requires GuidedOnboardingHostApi and mounts it", () => {
      expect(onboardingWeb.installation.hosts.requires).toContain("GuidedOnboardingHostApi");
      expect(onboardingWeb.installation.hosts.mounts).toHaveProperty("GuidedOnboardingHostApi");
    });

    it("answers with the GuidedOnboardingHostMount component", async () => {
      const mount = onboardingWeb.installation.hosts.mounts["GuidedOnboardingHostApi"];
      const loaded = await mount?.load();

      expect(loaded).toHaveProperty("default");
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the Onboarding component", async () => {
      const screen = onboardingWeb.installation.screens["pages/onboarding"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the Welcome component", async () => {
      const screen = onboardingWeb.installation.screens["pages/onboarding/welcome"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the Product component", async () => {
      const screen = onboardingWeb.installation.screens["pages/onboarding/product/index"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the Project component", async () => {
      const screen = onboardingWeb.installation.screens["pages/onboarding/[team]/project"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
