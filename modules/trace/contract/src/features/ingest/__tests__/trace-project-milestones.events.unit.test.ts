import { describe, expect, it } from "vitest";

import { firstTraceRecordedEventDataSchema } from "../trace-project-milestones.events.ts";

describe("firstTraceRecordedEventDataSchema", () => {
  const recorded = {
    tenantId: "project-1",
    projectId: "project-1",
    userId: "admin-1",
    sdkLanguage: "python",
    sdkFramework: "unknown",
    occurredAt: 1_000,
  };

  describe("given a first-trace fact that names the admin's organization", () => {
    /** @scenario "A project's first trace's fact names the admin's organization" */
    it("keeps the organization's id", () => {
      expect(
        firstTraceRecordedEventDataSchema.parse({ ...recorded, organizationId: "org-1" }),
      ).toMatchObject({ organizationId: "org-1" });
    });
  });

  describe("given a first-trace fact recorded before facts named their organization", () => {
    /** @scenario "A project's first trace's fact names the admin's organization" */
    it("still parses, with no organization", () => {
      const parsed = firstTraceRecordedEventDataSchema.parse(recorded);

      expect(parsed).toEqual(recorded);
      expect(parsed).not.toHaveProperty("organizationId");
    });
  });
});
