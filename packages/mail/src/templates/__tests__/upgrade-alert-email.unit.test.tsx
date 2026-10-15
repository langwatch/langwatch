import { describe, expect, it } from "vitest";

import {
  renderUpgradeAlertEmail,
  upgradeAlertEmailProps,
  upgradeAlertEmailTemplate,
} from "../upgrade-alert-email.tsx";

describe("renderUpgradeAlertEmail", () => {
  describe("when several steps failed", () => {
    /** @scenario "An upgrade alert shows each failed step with its error and its own link" */
    it("counts them in the subject and links each one", async () => {
      const fixture = upgradeAlertEmailTemplate.fixtures.find(
        ({ name }) => name === "several steps failed",
      );
      if (!fixture) throw new Error("fixture missing");
      const props = upgradeAlertEmailProps.parse(fixture.props);

      const { subject, html } = await renderUpgradeAlertEmail(props);

      expect(subject).toBe("2 upgrade steps failed on langwatch.acme.example");
      for (const step of props.failedSteps) {
        expect(html).toContain(step.id);
        expect(html).toContain(step.url);
      }
      expect(html).toContain("release 3.23.0");
      expect(html).toContain("Cannot read properties of null (reading &#x27;organizationId&#x27;)");
    });
  });
});
