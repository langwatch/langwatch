import { describe, expect, it } from "vitest";

import { ContentSecurityPolicy } from "../content-security-policy.ts";

describe("given the chart sandbox ships its own frame policy", () => {
  describe("when the app's own policy is built", () => {
    /** @scenario "The app's own policy is unchanged by the sandbox" */
    it("does not admit unpkg.com or esm.sh into the app's script-src", () => {
      const scriptSrc = ContentSecurityPolicy.app()
        .value.split("; ")
        .find((directive) => directive.startsWith("script-src "));

      expect(scriptSrc).toBeDefined();
      expect(scriptSrc).not.toMatch(/unpkg\.com|esm\.sh/);
    });
  });
});
