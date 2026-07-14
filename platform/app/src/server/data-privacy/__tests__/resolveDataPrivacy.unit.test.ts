import { describe, expect, it } from "vitest";
import type { DataPrivacyConfig } from "../dataPrivacy.types";
import {
  type DataPrivacyRow,
  type DataPrivacyScopeFacts,
  resolveDataPrivacy,
} from "../resolveDataPrivacy";

const teamProject: DataPrivacyScopeFacts = {
  organizationId: "acme",
  teamId: "platform",
  projectId: "web-app",
  departmentId: null,
  isPersonal: false,
};

const hrProject: DataPrivacyScopeFacts = {
  ...teamProject,
  departmentId: "hr",
};

function rule(
  scopeType: DataPrivacyRow["scopeType"],
  scopeId: string,
  config: DataPrivacyConfig,
  personalOnly = false,
): DataPrivacyRow {
  return { scopeType, scopeId, personalOnly, config };
}

describe("resolveDataPrivacy", () => {
  describe("given no rule anywhere in the chain", () => {
    /** @scenario A project with no rule resolves to the platform defaults */
    it("resolves to captured content, essential PII, and secrets on", () => {
      const resolved = resolveDataPrivacy({ rows: [], facts: teamProject });

      expect(resolved.categories.input.disposition).toBe("capture");
      expect(resolved.categories.output.disposition).toBe("capture");
      expect(resolved.pii.level).toBe("essential");
      expect(resolved.secrets.enabled).toBe(true);
    });
  });

  describe("given an organization rule", () => {
    /** @scenario An organization rule applies to every project in the org */
    it("applies to a project with no closer rule", () => {
      const rows = [
        rule("ORGANIZATION", "acme", {
          categories: { input: { disposition: "drop" } },
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      expect(resolved.categories.input.disposition).toBe("drop");
    });
  });

  describe("given an organization rule and a project rule on the same field", () => {
    /** @scenario A project rule beats an organization rule */
    it("lets the project rule win", () => {
      const rows = [
        rule("ORGANIZATION", "acme", {
          categories: { input: { disposition: "drop" } },
        }),
        rule("PROJECT", "web-app", {
          categories: { input: { disposition: "capture" } },
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      expect(resolved.categories.input.disposition).toBe("capture");
    });
  });

  describe("given an organization rule and a team rule", () => {
    /** @scenario A team rule sits between organization and project */
    it("lets the team rule win over the organization rule", () => {
      const rows = [
        rule("ORGANIZATION", "acme", {
          categories: { input: { disposition: "capture" } },
        }),
        rule("TEAM", "platform", {
          categories: { input: { disposition: "drop" } },
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      expect(resolved.categories.input.disposition).toBe("drop");
    });
  });

  describe("given a project assigned to a department", () => {
    /** @scenario A department rule applies to projects assigned to that department */
    it("applies the department rule", () => {
      const rows = [
        rule("DEPARTMENT", "hr", {
          categories: {
            output: { disposition: "restrict", audience: { admins: true } },
          },
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: hrProject });

      expect(resolved.categories.output.disposition).toBe("restrict");
      expect(resolved.categories.output.audience.admins).toBe(true);
    });

    /** @scenario A department rule beats a team rule for the same project */
    it("lets the department rule win over the team rule", () => {
      const rows = [
        rule("TEAM", "platform", {
          categories: { output: { disposition: "capture" } },
        }),
        rule("DEPARTMENT", "hr", {
          categories: { output: { disposition: "drop" } },
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: hrProject });

      expect(resolved.categories.output.disposition).toBe("drop");
    });
  });

  describe("given rules at different tiers on different fields", () => {
    /** @scenario Settings resolve independently across tiers */
    it("resolves each field from its own most-specific rule", () => {
      const rows = [
        rule("ORGANIZATION", "acme", { pii: { level: "strict" } }),
        rule("TEAM", "platform", {
          categories: { input: { disposition: "drop" } },
        }),
        rule("PROJECT", "web-app", {
          categories: {
            output: { disposition: "restrict", audience: { admins: true } },
          },
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      expect(resolved.categories.input.disposition).toBe("drop");
      expect(resolved.categories.output.disposition).toBe("restrict");
      expect(resolved.pii.level).toBe("strict");
    });
  });

  describe("given an organization rule narrowed to personal projects", () => {
    const aliceWorkspace: DataPrivacyScopeFacts = {
      organizationId: "acme",
      teamId: "alice-personal-team",
      projectId: "alice-workspace",
      departmentId: null,
      isPersonal: true,
    };

    /** @scenario A rule for all personal projects covers a personal workspace but not a team project */
    it("covers a personal workspace but leaves a team project at the default", () => {
      const rows = [
        rule(
          "ORGANIZATION",
          "acme",
          { categories: { input: { disposition: "drop" } } },
          true,
        ),
      ];

      expect(
        resolveDataPrivacy({ rows, facts: aliceWorkspace }).categories.input
          .disposition,
      ).toBe("drop");
      expect(
        resolveDataPrivacy({ rows, facts: teamProject }).categories.input
          .disposition,
      ).toBe("capture");
    });
  });

  describe("given a department rule narrowed to personal projects", () => {
    const bobWorkspace: DataPrivacyScopeFacts = {
      organizationId: "acme",
      teamId: "bob-personal-team",
      projectId: "bob-workspace",
      departmentId: "hr", // resolved through the owner
      isPersonal: true,
    };

    /** @scenario A department rule narrowed to personal projects follows the owner's department */
    it("applies to a personal project whose owner is in that department", () => {
      const rows = [
        rule(
          "DEPARTMENT",
          "hr",
          { categories: { input: { disposition: "drop" } } },
          true,
        ),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: bobWorkspace });

      expect(resolved.categories.input.disposition).toBe("drop");
    });
  });

  describe("given custom attribute rules at two tiers", () => {
    /** @scenario Custom attribute rules accumulate down the cascade */
    it("unions the distinct patterns from every matching rule", () => {
      const rows = [
        rule("ORGANIZATION", "acme", {
          customAttributes: [
            { pattern: "http.request.body", disposition: "drop" },
          ],
        }),
        rule("PROJECT", "web-app", {
          customAttributes: [
            { pattern: "app.session_token", disposition: "drop" },
          ],
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      const patterns = resolved.customAttributes.map((r) => r.pattern);
      expect(patterns).toContain("http.request.body");
      expect(patterns).toContain("app.session_token");
    });

    /** @scenario A narrower scope overrides the same attribute pattern from a wider scope */
    it("lets the most-specific scope win when both set the same pattern", () => {
      const rows = [
        rule("ORGANIZATION", "acme", {
          customAttributes: [
            { pattern: "app.session_token", disposition: "drop" },
          ],
        }),
        rule("PROJECT", "web-app", {
          customAttributes: [
            {
              pattern: "app.session_token",
              disposition: "restrict",
              audience: { admins: true },
            },
          ],
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      const entry = resolved.customAttributes.find(
        (r) => r.pattern === "app.session_token",
      );
      expect(resolved.customAttributes).toHaveLength(1);
      expect(entry?.disposition).toBe("restrict");
      expect(entry?.audience.admins).toBe(true);
    });
  });

  describe("when a custom PII level selects entities", () => {
    it("carries the level and its entities through the cascade", () => {
      const rows = [
        rule("PROJECT", "web-app", {
          pii: { level: "custom", entities: ["EMAIL_ADDRESS", "BR_CPF"] },
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      expect(resolved.pii.level).toBe("custom");
      expect(resolved.pii.entities).toEqual(["EMAIL_ADDRESS", "BR_CPF"]);
    });
  });

  // The Data Privacy snapshot derives effectiveOrganization / effectiveTeam by
  // resolving with synthetic facts whose narrower scope ids are empty, so the
  // PROJECT (and TEAM, for the org baseline) chain entries match no row. That is
  // what makes the settings page's effective summary follow the scope filter.
  describe("given org, team, and project rules on PII", () => {
    const rows = [
      rule("ORGANIZATION", "acme", { pii: { level: "essential" } }),
      rule("TEAM", "platform", { pii: { level: "strict" } }),
      rule("PROJECT", "web-app", { pii: { level: "disabled" } }),
    ];

    /** @scenario The effective summary resolves a baseline for the selected scope tier */
    it("resolves a baseline per scope tier from synthetic facts", () => {
      const orgBaseline = resolveDataPrivacy({
        rows,
        facts: {
          organizationId: "acme",
          teamId: "",
          projectId: "",
          departmentId: null,
          isPersonal: false,
        },
      });
      const teamBaseline = resolveDataPrivacy({
        rows,
        facts: {
          organizationId: "acme",
          teamId: "platform",
          projectId: "",
          departmentId: null,
          isPersonal: false,
        },
      });
      const projectPolicy = resolveDataPrivacy({ rows, facts: teamProject });

      expect(orgBaseline.pii.level).toBe("essential");
      expect(teamBaseline.pii.level).toBe("strict");
      expect(projectPolicy.pii.level).toBe("disabled");
    });
  });
});
