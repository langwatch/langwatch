/**
 * Experiment precedence, and the two shapes the type system cannot express:
 * an experiment must be a browser-visible PRODUCT flag, and a signed-out
 * visitor must see nothing that did not opt into pre-authentication.
 */
import { describe, expect, it } from "vitest";
import {
  findExperimentDefinitionViolations,
  isExperimentVisibleToTarget,
  resolveExperimentDecision,
  type ExperimentEvaluationTarget,
  type FeatureFlagExperiment,
} from "../src/feature-flag-experiment";

const EXPERIMENT: FeatureFlagExperiment = {
  title: "An experiment",
  summary: "Something a person can turn on for themselves.",
  catalogueVersion: 1,
};
const PUBLIC_EXPERIMENT: FeatureFlagExperiment = {
  ...EXPERIMENT,
  publicAnonymous: true,
};

const USER: ExperimentEvaluationTarget = { kind: "user", userId: "user_1" };
const PROJECT: ExperimentEvaluationTarget = {
  kind: "project",
  userId: "user_1",
  projectId: "project_1",
  organizationId: "org_1",
};
const ANONYMOUS: ExperimentEvaluationTarget = {
  kind: "anonymous",
  anonymousId: "0b7f4b4e-2b1a-4a5e-9c4d-2f1e7a9b3c5d",
};

function decide(overrides: {
  target?: ExperimentEvaluationTarget;
  experiment?: FeatureFlagExperiment;
  available?: boolean;
  projectPolicy?: "inherit" | "enabled" | "disabled";
  organizationPolicy?: "inherit" | "enabled" | "disabled";
  userEnrolled?: boolean;
}) {
  return resolveExperimentDecision({
    experiment: overrides.experiment ?? EXPERIMENT,
    target: overrides.target ?? PROJECT,
    available: overrides.available ?? true,
    projectPolicy: overrides.projectPolicy ?? "inherit",
    organizationPolicy: overrides.organizationPolicy ?? "inherit",
    userEnrolled: overrides.userEnrolled ?? false,
  });
}

describe("findExperimentDefinitionViolations", () => {
  const good = {
    key: "release_ui_navigation_v2_enabled",
    scope: "PRODUCT" as const,
    experiment: EXPERIMENT,
  };
  const browserVisibleKeys = ["release_ui_navigation_v2_enabled"];

  function check(definition: {
    key: string;
    scope: "SYSTEM" | "PRODUCT";
    experiment?: FeatureFlagExperiment;
  }) {
    return findExperimentDefinitionViolations({
      definitions: [definition],
      browserVisibleKeys,
    });
  }

  describe("given a well-formed experiment definition", () => {
    it("reports nothing", () => {
      expect(check(good)).toEqual([]);
    });
  });

  describe("given a flag with no experiment metadata", () => {
    it("reports nothing, whatever its scope", () => {
      expect(check({ key: "some_kill_switch", scope: "SYSTEM" })).toEqual([]);
    });
  });

  describe("given a SYSTEM flag marked as an experiment", () => {
    it("reports it, because a kill switch is not a personal choice", () => {
      expect(check({ ...good, scope: "SYSTEM" })).toEqual([
        "release_ui_navigation_v2_enabled: an experiment must be a PRODUCT flag, not SYSTEM",
      ]);
    });
  });

  describe("given an experiment the browser cannot see", () => {
    it("reports it", () => {
      expect(check({ ...good, key: "release_not_in_the_browser_list" })).toEqual([
        "release_not_in_the_browser_list: an experiment must be listed in FRONTEND_FEATURE_FLAGS",
      ]);
    });
  });

  describe("given an experiment with no customer-facing copy", () => {
    it("reports it", () => {
      expect(check({ ...good, experiment: { ...EXPERIMENT, title: "   ", summary: "" } })).toEqual([
        "release_ui_navigation_v2_enabled: an experiment needs a title and a summary",
      ]);
    });
  });

  describe("given catalogue versions that do not strictly increase", () => {
    it("reports the one that does not advance the watermark", () => {
      const violations = findExperimentDefinitionViolations({
        definitions: [good, { ...good, key: "release_ui_ai_gateway_menu_enabled" }],
        browserVisibleKeys: [
          "release_ui_navigation_v2_enabled",
          "release_ui_ai_gateway_menu_enabled",
        ],
      });

      expect(violations).toEqual([
        "release_ui_ai_gateway_menu_enabled: catalogueVersion must be greater than every earlier experiment (saw 1 after 1)",
      ]);
    });
  });

  describe("given a catalogue version that cannot order anything", () => {
    it.each([0, -1, 1.5])("reports %s", (catalogueVersion) => {
      expect(check({ ...good, experiment: { ...EXPERIMENT, catalogueVersion } })).toEqual([
        "release_ui_navigation_v2_enabled: catalogueVersion must be a positive integer",
      ]);
    });
  });

  describe("given several bad definitions", () => {
    it("reports every violation rather than the first", () => {
      const violations = findExperimentDefinitionViolations({
        definitions: [
          { ...good, scope: "SYSTEM" },
          {
            ...good,
            key: "release_unlisted",
            experiment: { ...EXPERIMENT, catalogueVersion: 2 },
          },
        ],
        browserVisibleKeys,
      });

      expect(violations).toEqual([
        "release_ui_navigation_v2_enabled: an experiment must be a PRODUCT flag, not SYSTEM",
        "release_unlisted: an experiment must be listed in FRONTEND_FEATURE_FLAGS",
      ]);
    });
  });
});

describe("isExperimentVisibleToTarget", () => {
  describe("given a signed-out visitor", () => {
    it("hides an experiment that did not opt into pre-authentication", () => {
      expect(isExperimentVisibleToTarget({ experiment: EXPERIMENT, target: ANONYMOUS })).toBe(
        false,
      );
    });

    it("shows one that did", () => {
      expect(
        isExperimentVisibleToTarget({
          experiment: PUBLIC_EXPERIMENT,
          target: ANONYMOUS,
        }),
      ).toBe(true);
    });
  });

  describe("given a signed-in person", () => {
    it("shows an ordinary experiment", () => {
      expect(isExperimentVisibleToTarget({ experiment: EXPERIMENT, target: USER })).toBe(true);
    });
  });
});

describe("resolveExperimentDecision", () => {
  describe("given the experiment is not available", () => {
    it("stays off however the person and the tenant chose", () => {
      expect(decide({ available: false, projectPolicy: "enabled", userEnrolled: true })).toEqual({
        enabled: false,
        decision: "unavailable",
      });
    });
  });

  describe("given no tenant policy", () => {
    it("follows the person's own opt-in", () => {
      expect(decide({ userEnrolled: true })).toEqual({
        enabled: true,
        decision: "user-enrolled",
      });
    });

    it("stays off for a person who has not opted in", () => {
      expect(decide({ userEnrolled: false })).toEqual({
        enabled: false,
        decision: "user-not-enrolled",
      });
    });
  });

  describe("given an owner set a tenant policy", () => {
    it("disables it over the person's opt-in", () => {
      expect(decide({ organizationPolicy: "disabled", userEnrolled: true })).toEqual({
        enabled: false,
        decision: "tenant-disabled",
      });
    });

    it("enables it for a person who never opted in", () => {
      expect(decide({ organizationPolicy: "enabled", userEnrolled: false })).toEqual({
        enabled: true,
        decision: "tenant-enabled",
      });
    });

    it("lets a project disable override an organization enable", () => {
      expect(
        decide({
          projectPolicy: "disabled",
          organizationPolicy: "enabled",
          userEnrolled: true,
        }),
      ).toEqual({ enabled: false, decision: "tenant-disabled" });
    });

    it("lets a project enable override an organization disable", () => {
      expect(
        decide({
          projectPolicy: "enabled",
          organizationPolicy: "disabled",
          userEnrolled: false,
        }),
      ).toEqual({ enabled: true, decision: "tenant-enabled" });
    });

    it("falls back to the organization when the project inherits", () => {
      expect(decide({ projectPolicy: "inherit", organizationPolicy: "disabled" })).toEqual({
        enabled: false,
        decision: "tenant-disabled",
      });
    });
  });

  describe("given a signed-out visitor", () => {
    it("is decided by availability alone for a public experiment", () => {
      expect(decide({ target: ANONYMOUS, experiment: PUBLIC_EXPERIMENT })).toEqual({
        enabled: true,
        decision: "anonymous-bucket",
      });
    });

    it("is off for an experiment that is not public", () => {
      expect(decide({ target: ANONYMOUS })).toEqual({
        enabled: false,
        decision: "unavailable",
      });
    });

    it("cannot be turned on by a tenant policy it has no tenant for", () => {
      expect(
        decide({
          target: ANONYMOUS,
          experiment: PUBLIC_EXPERIMENT,
          available: false,
          projectPolicy: "enabled",
        }),
      ).toEqual({ enabled: false, decision: "unavailable" });
    });
  });
});
