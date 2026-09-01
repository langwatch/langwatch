/**
 * What this package installs for itself, and how a host's install meets it.
 *
 * The governance move made `apps/ui` a package that serves pages, and this is
 * the seam that made that possible without editing the host: eleven loaders and
 * a feature transport declared here, merged under whatever the composing
 * application passes.
 */

import { describe, expect, it } from "vitest";
import { UiFeedbackPort, UiSessionPort } from "../src/behavior/ui-capabilities";
import { installedUiFeatures, mergeUiFeatureInstalls } from "../src/features/installed-ui-features";

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
    it("registers a loader for every governance page key the route table names", () => {
      expect(Object.keys(installedUiFeatures.loaders ?? {}).sort()).toEqual(
        [...GOVERNANCE_PAGE_KEYS].sort(),
      );
    });

    it("mounts the governance feature's own transport Provider", () => {
      expect(installedUiFeatures.apis?.map((api) => api.name)).toEqual([
        "@langwatch/enterprise-governance-web",
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

      expect(Object.keys(merged.loaders ?? {}).sort()).toEqual([...GOVERNANCE_PAGE_KEYS].sort());
      expect(merged.apis).toHaveLength(1);
      expect(merged.session).toBe(installedUiFeatures.session);
    });
  });
});
