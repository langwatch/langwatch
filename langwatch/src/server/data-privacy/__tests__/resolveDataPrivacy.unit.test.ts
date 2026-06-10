import { describe, expect, it } from "vitest";

import {
  resolveDataPrivacy,
  type DataPrivacyRow,
  type DataPrivacyScopeFacts,
} from "../resolveDataPrivacy";
import type { DataPrivacyConfig } from "../dataPrivacy.types";

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
      const rows = [rule("ORGANIZATION", "acme", { categories: { input: { disposition: "drop" } } })];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      expect(resolved.categories.input.disposition).toBe("drop");
    });
  });

  describe("given an organization rule and a project rule on the same field", () => {
    /** @scenario A project rule beats an organization rule */
    it("lets the project rule win", () => {
      const rows = [
        rule("ORGANIZATION", "acme", { categories: { input: { disposition: "drop" } } }),
        rule("PROJECT", "web-app", { categories: { input: { disposition: "capture" } } }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      expect(resolved.categories.input.disposition).toBe("capture");
    });
  });

  describe("given an organization rule and a team rule", () => {
    /** @scenario A team rule sits between organization and project */
    it("lets the team rule win over the organization rule", () => {
      const rows = [
        rule("ORGANIZATION", "acme", { categories: { input: { disposition: "capture" } } }),
        rule("TEAM", "platform", { categories: { input: { disposition: "drop" } } }),
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
          categories: { output: { disposition: "restrict", audience: { admins: true } } },
        }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: hrProject });

      expect(resolved.categories.output.disposition).toBe("restrict");
      expect(resolved.categories.output.audience.admins).toBe(true);
    });

    /** @scenario A department rule beats a team rule for the same project */
    it("lets the department rule win over the team rule", () => {
      const rows = [
        rule("TEAM", "platform", { categories: { output: { disposition: "capture" } } }),
        rule("DEPARTMENT", "hr", { categories: { output: { disposition: "drop" } } }),
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
        rule("TEAM", "platform", { categories: { input: { disposition: "drop" } } }),
        rule("PROJECT", "web-app", {
          categories: { output: { disposition: "restrict", audience: { admins: true } } },
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
        rule("ORGANIZATION", "acme", { categories: { input: { disposition: "drop" } } }, true),
      ];

      expect(resolveDataPrivacy({ rows, facts: aliceWorkspace }).categories.input.disposition).toBe(
        "drop",
      );
      expect(resolveDataPrivacy({ rows, facts: teamProject }).categories.input.disposition).toBe(
        "capture",
      );
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
        rule("DEPARTMENT", "hr", { categories: { input: { disposition: "drop" } } }, true),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: bobWorkspace });

      expect(resolved.categories.input.disposition).toBe("drop");
    });
  });

  describe("given custom drop-keys at two tiers", () => {
    /** @scenario Extra keys to drop accumulate down the cascade */
    it("unions the keys from every matching rule", () => {
      const rows = [
        rule("ORGANIZATION", "acme", { customDropKeys: ["http.request.body"] }),
        rule("PROJECT", "web-app", { customDropKeys: ["app.session_token"] }),
      ];

      const resolved = resolveDataPrivacy({ rows, facts: teamProject });

      expect(resolved.customDropKeys).toContain("http.request.body");
      expect(resolved.customDropKeys).toContain("app.session_token");
    });
  });
});
