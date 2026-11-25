/**
 * The staff investigation read of one organization's flags (ADR-202, ops functions): the keys
 * that resolve on for it with organization context only, sorted.
 * @see dev/docs/adr/202-ops-agent-access.md
 */
import { describe, expect, it } from "vitest";

import { createFeatureFlagTestApp } from "./feature-flag.fixture.ts";

const ORGANIZATION_ID = "org-acme";
const OTHER_ORGANIZATION_ID = "org-other";
const TARGETED = "experiment_onboarding_langy_guided";
const GLOBAL = "ops_pii_strict_presidio_redaction_disabled";
const OTHER_TARGETED = "ops_evaluator_settings_recovery_disabled";
const KILL_SWITCH = "es-trace-span-ingest-killswitch";

async function seededApp() {
  const app = createFeatureFlagTestApp();
  const baseline = await app.findEnabledFlagsForOrganization({ organizationId: ORGANIZATION_ID });
  await app.setRules({
    key: TARGETED,
    rules: [{ match: { organizationId: ORGANIZATION_ID }, enabled: true }],
    lastEditedBy: null,
  });
  await app.setRules({
    key: OTHER_TARGETED,
    rules: [{ match: { organizationId: OTHER_ORGANIZATION_ID }, enabled: true }],
    lastEditedBy: null,
  });
  await app.setEnabled({ key: GLOBAL, enabled: true, lastEditedBy: null });
  await app.setEnabled({ key: KILL_SWITCH, enabled: true, lastEditedBy: null });
  return { app, baseline };
}

describe("FeatureFlagModule.findEnabledFlagsForOrganization", () => {
  describe("given an organization rule, another organization's rule and two global switches", () => {
    it("answers the organization's rule and the global switches, sorted", async () => {
      const { app, baseline } = await seededApp();

      const enabled = await app.findEnabledFlagsForOrganization({
        organizationId: ORGANIZATION_ID,
      });

      expect(baseline).not.toContain(TARGETED);
      expect(enabled).toEqual(
        [...new Set([...baseline, TARGETED, GLOBAL, KILL_SWITCH])].toSorted(),
      );
      expect(enabled).not.toContain(OTHER_TARGETED);
    });
  });

  describe("when another organization is asked", () => {
    it("answers that organization's rule and not the first one's", async () => {
      const { app } = await seededApp();

      const enabled = await app.findEnabledFlagsForOrganization({
        organizationId: OTHER_ORGANIZATION_ID,
      });

      expect(enabled).toContain(OTHER_TARGETED);
      expect(enabled).not.toContain(TARGETED);
    });
  });
});
