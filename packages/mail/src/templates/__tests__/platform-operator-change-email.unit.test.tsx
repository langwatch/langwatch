import { describe, expect, it } from "vitest";

import { renderPlatformOperatorChangeEmail } from "../platform-operator-change-email.tsx";

const BASE = {
  installation: "app.langwatch.ai",
  subjectName: "Ada Lovelace",
  subjectEmail: "ada@langwatch.ai",
  actorName: "Riley Chen",
  operatorsUrl: "https://app.langwatch.ai/ops/operators",
} as const;

describe("renderPlatformOperatorChangeEmail", () => {
  describe("when someone is given the role", () => {
    /** @scenario "A platform operator change tells who changed whose role and links to the Operators page" */
    it("names the person, who granted it and the installation, and links to Operators", async () => {
      const { subject, html } = await renderPlatformOperatorChangeEmail({
        ...BASE,
        change: "granted",
      });

      expect(subject).toBe("Ada Lovelace is now a platform operator on app.langwatch.ai");
      expect(html).toContain(
        "Riley Chen gave the platform operator role to Ada Lovelace on app.langwatch.ai.",
      );
      expect(html).toContain("ada@langwatch.ai");
      expect(html).toContain("revoke the role on the Operators page now");
      expect(html).toContain('href="https://app.langwatch.ai/ops/operators"');
    });
  });

  describe("when someone loses the role", () => {
    it("says the role was removed", async () => {
      const { subject, html } = await renderPlatformOperatorChangeEmail({
        ...BASE,
        change: "revoked",
      });

      expect(subject).toBe("Ada Lovelace is no longer a platform operator on app.langwatch.ai");
      expect(html).toContain(
        "Riley Chen removed the platform operator role from Ada Lovelace on app.langwatch.ai.",
      );
    });
  });

  describe("when the installation has no public address", () => {
    it("links nothing rather than a relative address", async () => {
      const { html } = await renderPlatformOperatorChangeEmail({
        ...BASE,
        change: "granted",
        operatorsUrl: null,
      });

      expect(html).not.toContain("Open Operators");
      expect(html).not.toContain('href="/ops/operators"');
    });
  });
});
