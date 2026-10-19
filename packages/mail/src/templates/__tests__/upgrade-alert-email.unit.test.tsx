import { describe, expect, it } from "vitest";

import {
  renderUpgradeAlertEmail,
  upgradeAlertEmailProps,
  upgradeAlertEmailTemplate,
} from "../upgrade-alert-email.tsx";

const renderFixture = async (name: string) => {
  const fixture = upgradeAlertEmailTemplate.fixtures.find((each) => each.name === name);
  if (!fixture) throw new Error(`fixture missing: ${name}`);
  const props = upgradeAlertEmailProps.parse(fixture.props);
  return { props, ...(await renderUpgradeAlertEmail(props)) };
};

describe("renderUpgradeAlertEmail", () => {
  describe("given a self-hosted installation", () => {
    describe("when several background steps failed", () => {
      /** @scenario "A self-hosted upgrade alert says what didn't finish in plain words" */
      it("names each step by what it does and links it, with no ids, errors or attempts", async () => {
        const { props, subject, html } = await renderFixture("several steps failed");

        expect(subject).toBe(
          "Part of your LangWatch upgrade didn't finish on langwatch.acme.example",
        );
        expect(html).toContain("Part of your LangWatch upgrade didn&#x27;t finish");
        expect(html).toContain("2 background steps of the LangWatch upgrade");
        expect(html).toContain("LangWatch keeps running");
        expect(html).toContain("Replays scenario events for runs still open.");
        for (const step of props.failedSteps) expect(html).toContain(step.url);
        expect(html).not.toContain("suite:replay-scenario-facts-for-open-runs</strong>");
        expect(html).not.toContain("invalid_value");
        expect(html).not.toContain("organizationId");
        expect(html).not.toContain("attempt");
      });

      /** @scenario "A self-hosted upgrade alert falls back to the step id when a step has no description" */
      it("shows the id of a step that declares no description", async () => {
        const { html } = await renderFixture("several steps failed");

        expect(html).toContain("<strong>project:record-created-facts</strong>");
      });

      /** @scenario "A self-hosted upgrade alert offers a retry and a way to reach the LangWatch team" */
      it("offers a retry from the step page and the support address for the details", async () => {
        const { html } = await renderFixture("several steps failed");

        expect(html).toContain("You can retry each step from its page.");
        expect(html).toContain("mailto:support@langwatch.ai");
        expect(html).toContain("the LangWatch team will look into it");
        expect(html).not.toContain("Fix each cause");
        expect(html).not.toContain("reply to this email");
      });
    });

    describe("when a blocking step failed", () => {
      /** @scenario "A self-hosted upgrade alert for a failed blocking step does not say LangWatch keeps running" */
      it("says the new version can't serve until the step finishes", async () => {
        const { props } = await renderFixture("one step failed");
        const blocking = upgradeAlertEmailProps.parse({
          ...props,
          failedSteps: props.failedSteps.map((step) => ({ ...step, mode: "blocking" })),
        });
        const { html } = await renderUpgradeAlertEmail(blocking);

        expect(html).toContain(
          "LangWatch can&#x27;t start serving the new version until it finishes",
        );
        expect(html).toContain("One step of the LangWatch upgrade");
        expect(html).not.toContain("LangWatch keeps running");
        expect(html).not.toContain("background step");
      });
    });

    describe("when the upgrade runner stopped", () => {
      /** @scenario "A self-hosted alert for a stopped runner asks for a running worker without internals" */
      it("asks for a running worker and leaves the lease and the process name out", async () => {
        const { subject, html } = await renderFixture("runner stopped");

        expect(subject).toBe("Your LangWatch upgrade stopped on langwatch.acme.example");
        expect(html).toContain("Check that a LangWatch worker is running");
        expect(html).not.toContain("lease");
        expect(html).not.toContain("worker-7f9c");
      });
    });
  });

  describe("given LangWatch Cloud", () => {
    describe("when several steps failed", () => {
      /** @scenario "An upgrade alert on LangWatch Cloud shows each failed step with its id, error and own link" */
      it("counts them in the subject and shows each id, release, error and link", async () => {
        const { props, subject, html } = await renderFixture(
          "several steps failed on LangWatch Cloud",
        );

        expect(subject).toBe("2 upgrade steps failed on app.langwatch.ai");
        for (const step of props.failedSteps) {
          expect(html).toContain(step.id);
          expect(html).toContain(step.url);
        }
        expect(html).toContain("release 3.23.0");
        expect(html).toContain("attempt 2");
        expect(html).toContain(
          "Cannot read properties of null (reading &#x27;organizationId&#x27;)",
        );
      });
    });
  });
});
