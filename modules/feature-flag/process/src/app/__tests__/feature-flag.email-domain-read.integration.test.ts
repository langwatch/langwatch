/**
 * A stored email domain rule reaches a signed-in user at that domain through the session's
 * email, read the way the welcome flow reads it: no project and no organization yet.
 * @see specs/ops/internal-feature-flags.feature
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { describe, expect, it } from "vitest";

import { createFeatureFlagTestApp } from "./feature-flag.fixture.ts";

const FLAG = "experiment_onboarding_langy_guided";
const TEAM_DOMAIN = "acme.com";

async function appWithDomainRule() {
  const app = createFeatureFlagTestApp();
  await app.setRules({
    key: FLAG,
    rules: [{ match: { emailDomain: TEAM_DOMAIN }, enabled: true }],
    lastEditedBy: null,
  });
  return app;
}

function readAsWelcomeFlow(
  app: Awaited<ReturnType<typeof appWithDomainRule>>,
  userEmail: string | undefined,
) {
  return app.isEnabledForCaller({
    flag: FLAG,
    projectId: null,
    organizationId: null,
    userId: "user-1",
    userEmail,
  });
}

describe("given the flag's only rule enables it for users at the team's domain", () => {
  describe("when a signed-in user at that domain reads it with no project and no organization", () => {
    /** @scenario "the frontend flag procedure resolves an email domain rule for the signed-in user" */
    /** @scenario "a fresh account at the team's email domain lands in the guided flow with only a domain rule set" */
    it("resolves enabled from the session's email alone", async () => {
      const app = await appWithDomainRule();
      await expect(readAsWelcomeFlow(app, `qa@${TEAM_DOMAIN}`)).resolves.toBe(true);
    });
  });

  describe("when a signed-in user at another domain reads it", () => {
    /** @scenario "the frontend flag procedure resolves an email domain rule for the signed-in user" */
    it("resolves to the row-level default, which is off", async () => {
      const app = await appWithDomainRule();
      await expect(readAsWelcomeFlow(app, "qa@example.com")).resolves.toBe(false);
    });
  });

  describe("when the domain is compared against a differently cased email", () => {
    it("still matches", async () => {
      const app = await appWithDomainRule();
      await expect(readAsWelcomeFlow(app, `QA@${TEAM_DOMAIN.toUpperCase()}`)).resolves.toBe(true);
    });
  });
});
