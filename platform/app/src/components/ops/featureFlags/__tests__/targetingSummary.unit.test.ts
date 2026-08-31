/**
 * @vitest-environment node
 *
 * The one-line summary under a flag's toggle. It is the page's only claim
 * about who a rule has already switched a flag on for, so it has to walk the
 * rules the way the resolver does — first match wins — rather than counting
 * every rule that says `enabled: true`.
 */
import { describe, expect, it } from "vitest";
import { summarizeTargeting, targetingLabel } from "../targetingSummary";

function labelFor(rules: Parameters<typeof summarizeTargeting>[0]) {
  return targetingLabel(summarizeTargeting(rules));
}

describe("given no rules", () => {
  it("has nothing to say", () => {
    expect(labelFor([])).toBeNull();
  });
});

describe("given rules that enable the flag for named targets", () => {
  it("counts the organizations and projects separately", () => {
    expect(
      labelFor([
        { match: { organizationId: "organization_a" }, enabled: true },
        { match: { organizationId: "organization_b" }, enabled: true },
        { match: { projectId: "project_c" }, enabled: true },
      ]),
    ).toBe("Enabled for 2 organizations, 1 project");
  });

  describe("when an earlier rule disables a target a later rule enables", () => {
    it("honors the earlier rule, so the page cannot contradict the resolver", () => {
      expect(
        labelFor([
          { match: { organizationId: "organization_a" }, enabled: false },
          { match: { organizationId: "organization_a" }, enabled: true },
        ]),
      ).toBeNull();
    });
  });
});

describe("given a rule that matches everyone", () => {
  it("says so, and ignores rules below it that can never fire", () => {
    expect(
      labelFor([
        { match: {}, enabled: true },
        { match: { organizationId: "organization_a" }, enabled: true },
      ]),
    ).toBe("Enabled for everyone via rule");
  });

  describe("when that rule disables the flag", () => {
    it("reports nothing enabled, and stops the walk there", () => {
      expect(
        labelFor([
          { match: {}, enabled: false },
          { match: { organizationId: "organization_a" }, enabled: true },
        ]),
      ).toBeNull();
    });
  });
});

describe("given a new-users rule", () => {
  /** @scenario "a new-users rule enables the flag for an organization created after its date" */
  it("names the date rather than being counted as a catch-all", () => {
    const summary = summarizeTargeting([
      { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
    ]);

    // The bug this pins: an age rule names neither an organization nor a
    // project, so a "matches everyone" test written as "no organization and
    // no project" reads it as a catch-all and reports the whole fleet.
    expect(summary.enabledForEveryone).toBe(false);
    expect(summary.enabledNewUsersSince).toBe("2026-06-01");
    expect(targetingLabel(summary)).toBe(
      "Enabled for organizations created on or after Jun 1, 2026",
    );
  });

  describe("when it is combined with an organization rule", () => {
    it("reports both", () => {
      expect(
        labelFor([
          { match: { organizationId: "organization_a" }, enabled: true },
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
        ]),
      ).toBe(
        "Enabled for 1 organization, organizations created on or after Jun 1, 2026",
      );
    });
  });

  describe("when the date is the boundary of a calendar day", () => {
    it("renders the day the operator typed, not the day before it", () => {
      // Formatting a UTC midnight in a zone west of Greenwich is how a rule
      // written for the 1st shows as the 31st.
      expect(
        labelFor([
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
        ]),
      ).toContain("Jun 1, 2026");
    });
  });

  describe("when the rule disables rather than enables", () => {
    it("reports nothing for it", () => {
      expect(
        labelFor([
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: false },
        ]),
      ).toBeNull();
    });
  });
});

describe("given a rule excludes a target before a catch-all enables everyone", () => {
  describe("when the note is written", () => {
    /** @scenario "a catch-all note admits the targets a rule above it excludes" */
    it("names the exception rather than claiming the whole fleet", () => {
      expect(
        labelFor([
          { match: { organizationId: "organization_a" }, enabled: false },
          { match: {}, enabled: true },
        ]),
      ).toBe("Enabled for everyone via rule, except 1 organization");
    });

    it("counts projects among the exceptions too", () => {
      expect(
        labelFor([
          { match: { organizationId: "organization_a" }, enabled: false },
          { match: { projectId: "project_a" }, enabled: false },
          { match: { projectId: "project_b" }, enabled: false },
          { match: {}, enabled: true },
        ]),
      ).toBe(
        "Enabled for everyone via rule, except 1 organization, 2 projects",
      );
    });
  });

  describe("when the earlier rules enable rather than exclude", () => {
    it("says everyone flatly, because nothing is left out", () => {
      expect(
        labelFor([
          { match: { organizationId: "organization_a" }, enabled: true },
          { match: {}, enabled: true },
        ]),
      ).toBe("Enabled for everyone via rule");
    });
  });
});

describe("given an age rule sits below a disabled age rule with an earlier date", () => {
  describe("when the note is written", () => {
    /** @scenario "a new-users rule an earlier rule already answered for is not claimed" */
    it("offers neither date, because the first rule answers for both", () => {
      // Every organization created since June was created since January, so
      // the January rule matches first and turns the flag off for all of them.
      expect(
        labelFor([
          { match: { organizationCreatedAfter: "2026-01-01" }, enabled: false },
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
        ]),
      ).toBeNull();
    });
  });

  describe("when the disabled rule names a later date", () => {
    it("still offers the earlier one, whose population it does not cover", () => {
      expect(
        labelFor([
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: false },
          { match: { organizationCreatedAfter: "2026-01-01" }, enabled: true },
        ]),
      ).toContain("Jan 1, 2026");
    });
  });

  describe("when the disabled rule also names an organization", () => {
    it("does not shadow, because it speaks for that organization alone", () => {
      expect(
        labelFor([
          {
            match: {
              organizationId: "organization_a",
              organizationCreatedAfter: "2026-01-01",
            },
            enabled: false,
          },
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
        ]),
      ).toContain("Jun 1, 2026");
    });
  });
});
