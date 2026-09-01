/**
 * What this package installs for itself, and how a host's install meets it.
 *
 * The governance move made `apps/ui` a package that serves pages, and this is
 * the seam that made that possible without editing the host: the loaders and
 * the feature transports are declared here, merged under whatever the composing
 * application passes.
 */

import { describe, expect, it } from "vitest";
import { UiFeedbackPort, UiSessionPort } from "../src/behavior/ui-capabilities";
import { installedUiFeatures, mergeUiFeatureInstalls } from "../src/features/installed-ui-features";

const AGENT_PAGE_KEYS = [
  // ONE key for ONE screen, and it still names the platform adapter that used
  // to serve it. The route transcript is the parity bar for the URL surface and
  // fails on any page-key change, so the key was left alone rather than spent
  // on a cosmetic rename — several other families' keys name platform modules
  // that no longer exist either.
  "runtime/ui/features/agent-ui-host.adapter",
];

const AUTOMATION_PAGE_KEYS = [
  // Five keys for ONE screen: the four tabs are four URLs of the same page, and
  // `/activity` is a fifth address that has shown the overview since the
  // History tab was folded into it. The feature maps each key to the tab it
  // shows, which is why the screen never reads the pathname.
  "pages/[project]/automations",
  "pages/[project]/automations/automations",
  "pages/[project]/automations/alerts",
  "pages/[project]/automations/schedules",
  "pages/[project]/automations/activity",
];

const GATEWAY_PAGE_KEYS = [
  "pages/gateway/virtual-keys",
  "pages/gateway/virtual-keys/[id]",
  "pages/gateway/budgets",
  "pages/gateway/budgets/[id]",
  "pages/gateway/routing-policies",
  "pages/gateway/usage",
  "pages/gateway/cache-rules",
  "pages/gateway/guardrails",
  "pages/gateway/billing-events",
  "pages/gateway/webhooks",
];

const PERSONAL_WORKSPACE_PAGE_KEYS = [
  "pages/me/index",
  "pages/me/configure",
  "pages/me/sessions",
  "pages/me/pull-requests",
  "pages/me/budget/request",
  // Two project-scoped keys, and they belong to this family because their
  // whole page bodies were its tables. They are children of a layout route the
  // host still serves, which the merge point makes possible.
  "pages/[project]/sessions",
  "pages/[project]/pull-requests",
];

const OPS_PAGE_KEYS = [
  "pages/ops/index",
  "pages/ops/dejaview",
  "pages/ops/event-sourcing/index",
  "pages/ops/event-sourcing/dead-letters",
  "pages/ops/event-sourcing/processes",
  "pages/ops/event-sourcing/projections",
  "pages/ops/event-sourcing/subscribers",
  "pages/ops/event-sourcing/schedules",
  "pages/ops/blobs",
  "pages/ops/feature-flags",
  "pages/ops/foundry",
  "pages/ops/migrations",
  "pages/ops/projections/[runId]",
  // Six keys for ONE screen, the automations shape again: the Backoffice's six
  // resources were six three-line page files around one admin-gated shell, so
  // the feature maps each key to the resource it shows and the screen is told
  // rather than reading the address.
  "pages/ops/backoffice/bug-reports",
  "pages/ops/backoffice/users",
  "pages/ops/backoffice/organizations",
  "pages/ops/backoffice/projects",
  "pages/ops/backoffice/subscriptions",
  "pages/ops/backoffice/sso-connections",
];

const GOVERNANCE_PAGE_KEYS = [
  "pages/governance/index",
  "pages/governance/inventory.enterprise",
  "pages/governance/ingestion-source-detail.enterprise",
  "pages/governance/anomaly-rules.enterprise",
  "pages/governance/people",
  "pages/governance/costs",
  "pages/governance/billed",
  "pages/governance/teams",
  "pages/governance/teams/[id]",
  "pages/governance/users",
  "pages/governance/users/[id]",
];

class RecordingFeedback extends UiFeedbackPort {
  succeeded(): void {}
  failed(): void {}
}

class RecordingSession extends UiSessionPort {
  currentUser() {
    return null;
  }
  activeScope() {
    return { organizationId: null, projectId: null };
  }
  hasPermission() {
    return false;
  }
  isSettled() {
    return true;
  }
  featureFlag() {
    return false;
  }
}

describe("given what apps/ui serves itself", () => {
  describe("when the standing declaration is read", () => {
    it("registers a loader for every page key the families it serves name", () => {
      expect(Object.keys(installedUiFeatures.loaders ?? {}).sort()).toEqual(
        [
          ...AGENT_PAGE_KEYS,
          ...AUTOMATION_PAGE_KEYS,
          ...GATEWAY_PAGE_KEYS,
          ...GOVERNANCE_PAGE_KEYS,
          ...OPS_PAGE_KEYS,
          ...PERSONAL_WORKSPACE_PAGE_KEYS,
        ].sort(),
      );
    });

    it("mounts each feature's own transport Provider", () => {
      // Seven rather than six: the personal workspace mounts two, because the
      // coding-agent tables its screens render call procedures of their own and
      // `apps/ui` may not import the package they live in.
      expect(installedUiFeatures.apis?.map((api) => api.name)).toEqual([
        "@langwatch/agent-web",
        "@langwatch/automation-web",
        "@langwatch/gateway-web",
        "@langwatch/enterprise-governance-web",
        "@langwatch/ops-web",
        "@langwatch/user-web",
        "@langwatch/coding-agent-web",
      ]);
    });

    it("answers the feedback capability rather than leaving the refusing default", () => {
      expect(installedUiFeatures.capabilities?.feedback).toBeInstanceOf(UiFeedbackPort);
    });

    it("reads the deployment's own session", () => {
      expect(installedUiFeatures.session).toBeTypeOf("function");
    });
  });

  describe("when a host brings an install of its own", () => {
    it("adds the host's loaders without dropping this package's", () => {
      const merged = mergeUiFeatureInstalls(installedUiFeatures, {
        loaders: { "pages/host/only": () => Promise.resolve({ default: () => null }) },
      });

      expect(Object.keys(merged.loaders ?? {})).toContain("pages/host/only");
      expect(Object.keys(merged.loaders ?? {})).toContain("pages/governance/index");
    });

    it("lets the host's capability win over this package's", () => {
      const hostFeedback = new RecordingFeedback();

      const merged = mergeUiFeatureInstalls(installedUiFeatures, {
        capabilities: { feedback: hostFeedback },
      });

      expect(merged.capabilities?.feedback).toBe(hostFeedback);
    });

    it("lets the host's session source win over this package's", () => {
      const hostSession = () => new RecordingSession();

      const merged = mergeUiFeatureInstalls(installedUiFeatures, { session: hostSession });

      expect(merged.session).toBe(hostSession);
    });

    it("keeps this package's install whole when the host brings nothing", () => {
      const merged = mergeUiFeatureInstalls(installedUiFeatures);

      expect(Object.keys(merged.loaders ?? {}).sort()).toEqual(
        [
          ...AGENT_PAGE_KEYS,
          ...AUTOMATION_PAGE_KEYS,
          ...GATEWAY_PAGE_KEYS,
          ...GOVERNANCE_PAGE_KEYS,
          ...OPS_PAGE_KEYS,
          ...PERSONAL_WORKSPACE_PAGE_KEYS,
        ].sort(),
      );
      expect(merged.apis).toHaveLength(7);
      expect(merged.session).toBe(installedUiFeatures.session);
    });
  });
});
