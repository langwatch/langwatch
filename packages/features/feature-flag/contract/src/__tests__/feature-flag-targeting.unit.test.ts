import { describe, expect, it } from "vitest";
import { NOT_TARGETED, toRuleContextId, type FeatureFlagTargetId } from "../feature-flag-targeting";
import { evaluateRules, type FeatureFlagRules } from "../feature-flag-rules";

/** Mirrors the shape every `use-feature-flag.ts` hook requires: both scopes
 * stated, so a forgotten field is a compile error rather than a silent
 * no-op rule. */
interface FeatureFlagReadOptions {
  distinctId: string;
  projectId: FeatureFlagTargetId;
  organizationId: FeatureFlagTargetId;
}

describe("given a read that leaves a scope out", () => {
  /** @scenario "a read that omits an id does not compile" */
  it("is rejected by the type of the options", () => {
    // @ts-expect-error organizationId is required on every flag read.
    const withoutOrganization: FeatureFlagReadOptions = {
      distinctId: "user-1",
      projectId: "project-1",
    };
    // @ts-expect-error projectId is required on every flag read.
    const withoutProject: FeatureFlagReadOptions = {
      distinctId: "user-1",
      organizationId: "organization-1",
    };

    expect(withoutOrganization.distinctId).toBe("user-1");
    expect(withoutProject.distinctId).toBe("user-1");
  });
});

describe("given a surface that has no project of its own", () => {
  /** @scenario "a caller with no project of its own opts that scope out by name" */
  it("states the exported opt-out value for the project", () => {
    const options: FeatureFlagReadOptions = {
      distinctId: "user-1",
      projectId: NOT_TARGETED,
      organizationId: "organization-1",
    };

    expect(options.projectId).toBe(NOT_TARGETED);
    expect(toRuleContextId(options.projectId)).toBeUndefined();
  });

  /** @scenario "an opted-out scope matches no rule that names that scope" */
  it("matches no rule that names a project", () => {
    const rules: FeatureFlagRules = [{ match: { projectId: "project-1" }, enabled: true }];

    const hit = evaluateRules(rules, {
      projectId: toRuleContextId(NOT_TARGETED),
      organizationId: toRuleContextId("organization-1"),
    });

    expect(hit).toBeNull();
  });
});

describe("given an id that is not known yet", () => {
  /** @scenario "an id that is not known yet is written out, not left out" */
  it("is written out and reaches the matcher as no context", () => {
    const options: FeatureFlagReadOptions = {
      distinctId: "user-1",
      projectId: "project-1",
      organizationId: undefined,
    };

    expect(toRuleContextId(options.organizationId)).toBeUndefined();
  });
});

describe("given a flag that is off by default with one organization rule", () => {
  /** @scenario "a read that carries the organization matches an organization rule" */
  it("resolves enabled for a read that carries that organization", () => {
    const rules: FeatureFlagRules = [
      { match: { organizationId: "organization-1" }, enabled: true },
    ];

    const hit = evaluateRules(rules, {
      projectId: "project-1",
      organizationId: "organization-1",
    });

    expect(hit).toBe(true);
  });
});
