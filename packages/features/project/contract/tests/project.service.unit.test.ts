import { describe, expect, it } from "vitest";
import {
  PROJECT_KIND,
  internalProjectQuerySchema,
  internalProjectSchema,
  projectPresenceInputSchema,
} from "../src";

describe("project contract", () => {
  it("accepts the portable internal-project boundary", () => {
    expect(
      internalProjectSchema.parse({
        id: "project_1",
        name: "Governance (internal)",
        slug: "governance-org_1",
        teamId: "team_1",
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        archivedAtMs: null,
        traceSharingEnabled: false,
      }),
    ).toMatchObject({ id: "project_1" });
  });

  it("rejects application projects at the internal boundary", () => {
    expect(() =>
      internalProjectQuerySchema.parse({
        organizationId: "org_1",
        kind: PROJECT_KIND.APPLICATION,
      }),
    ).toThrow();
  });

  it("validates a project-scoped presence decision", () => {
    expect(
      projectPresenceInputSchema.parse({ projectId: "project_1" }),
    ).toEqual({ projectId: "project_1" });
  });
});
