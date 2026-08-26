import { describe, expect, it } from "vitest";
import type { RetentionScopeGroup } from "@langwatch/data-retention-web";
import { retentionRemovalPreviewQuery } from "../data-retention-preview-query";

const group: RetentionScopeGroup = {
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  name: "Acme",
  byCategory: { traces: 91, scenarios: 91, experiments: 91 },
  rules: [],
};

describe("retention removal preview query", () => {
  it("is disabled while no scope is targeted", () => {
    const query = retentionRemovalPreviewQuery("project-1", null);

    expect(query).toEqual({
      input: {
        projectId: "project-1",
        scope: { scopeType: "PROJECT", scopeId: "" },
      },
      options: { enabled: false },
    });
  });

  it("targets and enables the selected scope", () => {
    const query = retentionRemovalPreviewQuery("project-1", group);

    expect(query).toEqual({
      input: {
        projectId: "project-1",
        scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
      },
      options: { enabled: true },
    });
  });
});
