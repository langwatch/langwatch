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
        [...GATEWAY_PAGE_KEYS, ...GOVERNANCE_PAGE_KEYS, ...PERSONAL_WORKSPACE_PAGE_KEYS].sort(),
      );
    });

    it("mounts each feature's own transport Provider", () => {
      // Four rather than three: the personal workspace mounts two, because the
      // coding-agent tables its screens render call procedures of their own and
      // `apps/ui` may not import the package they live in.
      expect(installedUiFeatures.apis?.map((api) => api.name)).toEqual([
        "@langwatch/gateway-web",
        "@langwatch/enterprise-governance-web",
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
        [...GATEWAY_PAGE_KEYS, ...GOVERNANCE_PAGE_KEYS, ...PERSONAL_WORKSPACE_PAGE_KEYS].sort(),
      );
      expect(merged.apis).toHaveLength(4);
      expect(merged.session).toBe(installedUiFeatures.session);
    });
  });
});
