/**
 * @vitest-environment jsdom
 * Project lends by the tokens in its client package, so a reader finds them without
 * importing project's browser package or naming a capability (§10.1).
 */
import { HeroAskFieldToken, ProjectSwitcherToken } from "@langwatch/project-client";
import { describe, expect, it } from "vitest";

import { projectWeb } from "../project.web.ts";

function lendOf({ key }: { key: string }) {
  return projectWeb.installation.lends.find(({ token }) => token.key === key);
}

describe("the project browser declaration", () => {
  describe("when a reader looks up each token from project's client", () => {
    /** @scenario Each wave 3 owner lends by its client tokens */
    it.each([HeroAskFieldToken, ProjectSwitcherToken])(
      "loads the lent component for $key",
      async (token) => {
        const lend = lendOf(token);
        const loaded = lend && "load" in lend ? await lend.load() : undefined;

        expect(loaded).toHaveProperty("default");
      },
    );
  });
});
