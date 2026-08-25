import { describe, expect, it } from "vitest";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  resolveDataPrivacy,
  type DataPrivacyScopeFacts,
} from "../src/index";

const facts: DataPrivacyScopeFacts = {
  organizationId: "org-1",
  teamId: "team-1",
  projectId: "project-1",
  departmentId: "dept-1",
  isPersonal: false,
};

describe("resolveDataPrivacy", () => {
  it("uses platform defaults when no scope has a rule", () => {
    expect(resolveDataPrivacy({ rows: [], facts })).toEqual(
      PLATFORM_DEFAULT_DATA_PRIVACY,
    );
  });

  it("resolves fields from the narrowest scope and unions patterns", () => {
    const resolved = resolveDataPrivacy({
      facts,
      rows: [
        {
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          personalOnly: false,
          config: {
            pii: { level: "essential" },
            secrets: { enabled: true, customPatterns: ["org-token"] },
          },
        },
        {
          scopeType: "TEAM",
          scopeId: "team-1",
          personalOnly: false,
          config: {
            categories: { input: { disposition: "drop" } },
            secrets: { enabled: false, customPatterns: ["team-token"] },
          },
        },
      ],
    });
    expect(resolved.categories.input.disposition).toBe("drop");
    expect(resolved.secrets.enabled).toBe(false);
    expect(resolved.secrets.customPatterns).toEqual(["team-token", "org-token"]);
  });
});
