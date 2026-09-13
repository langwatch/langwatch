/**
 * The People page's four summary figures.
 *
 * The rule under test is the honesty one: a read that has not answered leaves
 * its figure unmeasured, and an unmeasured figure is never a zero — an
 * organization that has not been counted must not be reported as an
 * organization with nobody in it.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */
import { describe, expect, it } from "vitest";

import type { PeopleRow } from "../peopleRows";
import { summarizePeople } from "../peopleSummary";

const row = (over: Partial<PeopleRow>): PeopleRow => ({
  key: "row",
  displayName: "Someone",
  identifier: null,
  provider: null,
  status: "unmatched",
  matchDetail: null,
  evidenceKind: null,
  department: null,
  spendUsd: null,
  requests: null,
  lastActiveIso: null,
  mostUsedTarget: null,
  actor: null,
  linkedUserId: null,
  isMachine: false,
  needsReview: false,
  suspendedReason: null,
  ...over,
});

const ROWS: PeopleRow[] = [
  row({ key: "a", status: "matched", department: "Engineering" }),
  row({ key: "b", status: "unmatched", department: "Engineering" }),
  row({ key: "c", status: "unmatched", department: null }),
  row({ key: "d", status: "erased", department: null }),
];

describe("summarizePeople", () => {
  describe("given every read has answered", () => {
    it("counts the population, the departments and the two gaps", () => {
      expect(
        summarizePeople({
          rows: ROWS,
          departmentCount: 3,
          peopleMeasured: true,
          departmentsMeasured: true,
        }),
      ).toEqual({
        people: 4,
        departments: 3,
        unmatched: 2,
        unassigned: 2,
      });
    });
  });

  describe("given the population reads have not answered", () => {
    it("leaves every figure they feed unmeasured, and departments alone", () => {
      expect(
        summarizePeople({
          rows: [],
          departmentCount: 3,
          peopleMeasured: false,
          departmentsMeasured: true,
        }),
      ).toEqual({
        people: null,
        departments: 3,
        unmatched: null,
        unassigned: null,
      });
    });
  });

  describe("given the department read has not answered", () => {
    it("leaves the department figure unmeasured rather than reporting none", () => {
      const summary = summarizePeople({
        rows: ROWS,
        departmentCount: 0,
        peopleMeasured: true,
        departmentsMeasured: false,
      });

      expect(summary.departments).toBeNull();
      expect(summary.people).toBe(4);
    });
  });

  describe("given an organization that genuinely has none of something", () => {
    it("reports zero, which is a measurement and not a gap", () => {
      expect(
        summarizePeople({
          rows: [],
          departmentCount: 0,
          peopleMeasured: true,
          departmentsMeasured: true,
        }),
      ).toEqual({
        people: 0,
        departments: 0,
        unmatched: 0,
        unassigned: 0,
      });
    });
  });
});
