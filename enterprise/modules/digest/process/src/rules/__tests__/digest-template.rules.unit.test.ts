// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly digest picks one of five templates per person: the first
 * eligible in a fixed order, from plain numbers.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { describe, expect, it } from "vitest";

import {
  DIGEST_TEMPLATE_THRESHOLDS,
  type DigestTemplateInput,
  eligibleDigestTemplates,
  pickDigestTemplate,
} from "../digest-template.rules.ts";

type InputOverrides = {
  member?: Partial<DigestTemplateInput["member"]>;
  organization?: Partial<DigestTemplateInput["organization"]>;
  project?: Partial<NonNullable<DigestTemplateInput["project"]>> | null;
};

function input(overrides: InputOverrides = {}): DigestTemplateInput {
  return {
    member: { isOrganizationAdmin: false, codingAgentSessions: 0, ...overrides.member },
    organization: { monthlyLimitUsedPercent: 10, ...overrides.organization },
    project:
      overrides.project === null
        ? null
        : {
            traces: 0,
            scenarioRuns: 0,
            scenarioFailures: 0,
            baselineWeeks: [],
            ...overrides.project,
          },
  };
}

const NO_BASELINE_FAILURES = [
  { runs: 10, failures: 1 },
  { runs: 10, failures: 1 },
  { runs: 10, failures: 1 },
  { runs: 10, failures: 1 },
];

describe("pickDigestTemplate()", () => {
  describe("when an organization admin's organization is at 85% of its monthly limit", () => {
    /** @scenario "An admin of an organization near its plan limit gets the plan-pressure email" */
    it("picks the plan-pressure template", () => {
      const picked = pickDigestTemplate(
        input({
          member: { isOrganizationAdmin: true, codingAgentSessions: 20 },
          organization: { monthlyLimitUsedPercent: 85 },
        }),
      );

      expect(picked).toEqual({ template: "digest-plan-pressure" });
    });
  });

  describe("when the organization is at exactly the plan-pressure threshold", () => {
    it("treats the threshold as eligible for an admin", () => {
      const picked = pickDigestTemplate(
        input({
          member: { isOrganizationAdmin: true },
          organization: { monthlyLimitUsedPercent: DIGEST_TEMPLATE_THRESHOLDS.planPressurePercent },
        }),
      );

      expect(picked.template).toBe("digest-plan-pressure");
    });

    it("does not pick plan-pressure just below it", () => {
      const picked = pickDigestTemplate(
        input({
          member: { isOrganizationAdmin: true },
          organization: {
            monthlyLimitUsedPercent: DIGEST_TEMPLATE_THRESHOLDS.planPressurePercent - 1,
          },
        }),
      );

      expect(picked.template).toBe("digest-whats-new");
    });
  });

  describe("when the organization has no monthly limit", () => {
    it("never picks plan-pressure", () => {
      const picked = pickDigestTemplate(
        input({
          member: { isOrganizationAdmin: true },
          organization: { monthlyLimitUsedPercent: null },
        }),
      );

      expect(picked.template).toBe("digest-whats-new");
    });
  });

  describe("when a member who is not an admin is in an organization at 100% of its monthly limit", () => {
    /** @scenario "A member who is not an admin never gets the plan-pressure email" */
    it("falls through to the coding-agent week", () => {
      const picked = pickDigestTemplate(
        input({
          member: { isOrganizationAdmin: false, codingAgentSessions: 20 },
          organization: { monthlyLimitUsedPercent: 100 },
        }),
      );

      expect(picked).toEqual({ template: "digest-coding-agent-week" });
    });
  });

  describe("when a project's scenario failure rate rose from its four-week baseline", () => {
    /** @scenario "A scenario failure rate that moved from its baseline picks the scenarios trend" */
    it("picks the scenarios trend saying more are failing than usual", () => {
      const picked = pickDigestTemplate(
        input({
          project: {
            scenarioRuns: 10,
            scenarioFailures: 3,
            baselineWeeks: [
              { runs: 10, failures: 1 },
              { runs: 10, failures: 1 },
              { runs: 10, failures: 1 },
              { runs: 10, failures: 1 },
            ],
          },
        }),
      );

      expect(picked).toEqual({ template: "digest-scenarios-trend", direction: "more_failing" });
    });
  });

  describe("when a project's scenario failure rate fell from its four-week baseline", () => {
    /** @scenario "A falling failure rate reads as getting better" */
    it("picks the scenarios trend saying the runs are getting better", () => {
      const picked = pickDigestTemplate(
        input({
          project: {
            scenarioRuns: 10,
            scenarioFailures: 1,
            baselineWeeks: [
              { runs: 10, failures: 3 },
              { runs: 10, failures: 3 },
              { runs: 10, failures: 3 },
              { runs: 10, failures: 3 },
            ],
          },
        }),
      );

      expect(picked).toEqual({ template: "digest-scenarios-trend", direction: "getting_better" });
    });
  });

  describe("when the failure rate moved by exactly the threshold", () => {
    it("counts a move of 10 points as a trend", () => {
      const picked = pickDigestTemplate(
        input({
          project: {
            scenarioRuns: 10,
            scenarioFailures: 3,
            baselineWeeks: [{ runs: 10, failures: 2 }],
          },
        }),
      );

      expect(picked.template).toBe("digest-scenarios-trend");
    });

    it("does not count a move of 9 points", () => {
      const picked = pickDigestTemplate(
        input({
          project: {
            scenarioRuns: 100,
            scenarioFailures: 29,
            baselineWeeks: [{ runs: 100, failures: 20 }],
          },
        }),
      );

      expect(picked.template).toBe("digest-whats-new");
    });
  });

  describe("when the baseline spans weeks of different size", () => {
    it("weighs the baseline by runs, not by week", () => {
      const picked = pickDigestTemplate(
        input({
          project: {
            scenarioRuns: 10,
            scenarioFailures: 3,
            baselineWeeks: [
              { runs: 1, failures: 1 },
              { runs: 99, failures: 9 },
              { runs: 0, failures: 0 },
            ],
          },
        }),
      );

      expect(picked).toEqual({ template: "digest-scenarios-trend", direction: "more_failing" });
    });
  });

  describe("when a project has scenario runs this week and none in the four weeks before", () => {
    /** @scenario "A project with no scenario history has no trend" */
    it("does not pick the scenarios trend", () => {
      const picked = pickDigestTemplate(
        input({
          project: {
            scenarioRuns: 10,
            scenarioFailures: 10,
            baselineWeeks: [
              { runs: 0, failures: 0 },
              { runs: 0, failures: 0 },
              { runs: 0, failures: 0 },
              { runs: 0, failures: 0 },
            ],
          },
        }),
      );

      expect(picked.template).not.toBe("digest-scenarios-trend");
    });
  });

  describe("when a project has a baseline but no scenario runs this week", () => {
    it("does not pick the scenarios trend", () => {
      const picked = pickDigestTemplate(
        input({
          project: { scenarioRuns: 0, scenarioFailures: 0, baselineWeeks: NO_BASELINE_FAILURES },
        }),
      );

      expect(picked.template).not.toBe("digest-scenarios-trend");
    });
  });

  describe("when a project has 12,000 traces this week and no coding-agent sessions", () => {
    /** @scenario "A busy project picks the traces week" */
    it("picks the traces week", () => {
      const picked = pickDigestTemplate(
        input({ member: { codingAgentSessions: 0 }, project: { traces: 12_000 } }),
      );

      expect(picked).toEqual({ template: "digest-traces-week" });
    });
  });

  describe("when a member has 40 traces and no coding-agent sessions this week", () => {
    /** @scenario "Low usage falls back to what's new" */
    it("falls back to what's new", () => {
      const picked = pickDigestTemplate(
        input({ member: { codingAgentSessions: 0 }, project: { traces: 40 } }),
      );

      expect(picked).toEqual({ template: "digest-whats-new" });
    });
  });

  describe("when a member belongs to no project", () => {
    it("still picks from what the person and organization show", () => {
      const sessions = DIGEST_TEMPLATE_THRESHOLDS.codingAgentSessions;

      expect(
        pickDigestTemplate(input({ project: null, member: { codingAgentSessions: sessions } }))
          .template,
      ).toBe("digest-coding-agent-week");
      expect(pickDigestTemplate(input({ project: null })).template).toBe("digest-whats-new");
    });
  });

  describe("when several templates are eligible", () => {
    it("takes the first in the fixed order", () => {
      const everything = input({
        member: { isOrganizationAdmin: true, codingAgentSessions: 20 },
        organization: { monthlyLimitUsedPercent: 90 },
        project: {
          traces: 5_000,
          scenarioRuns: 10,
          scenarioFailures: 5,
          baselineWeeks: [{ runs: 10, failures: 1 }],
        },
      });

      expect(eligibleDigestTemplates(everything).map((pick) => pick.template)).toEqual([
        "digest-plan-pressure",
        "digest-scenarios-trend",
        "digest-coding-agent-week",
        "digest-traces-week",
        "digest-whats-new",
      ]);
      expect(pickDigestTemplate(everything).template).toBe("digest-plan-pressure");
    });
  });

  describe("when the thresholds sit exactly on a boundary", () => {
    it("is eligible at 5 coding-agent sessions and not at 4", () => {
      expect(pickDigestTemplate(input({ member: { codingAgentSessions: 5 } })).template).toBe(
        "digest-coding-agent-week",
      );
      expect(pickDigestTemplate(input({ member: { codingAgentSessions: 4 } })).template).toBe(
        "digest-whats-new",
      );
    });

    it("is eligible at 1,000 traces and not at 999", () => {
      expect(pickDigestTemplate(input({ project: { traces: 1_000 } })).template).toBe(
        "digest-traces-week",
      );
      expect(pickDigestTemplate(input({ project: { traces: 999 } })).template).toBe(
        "digest-whats-new",
      );
    });
  });
});
