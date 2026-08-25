import { describe, expect, it } from "vitest";
import {
  activityMonitorPagedWindowQuerySchema,
  createGovernanceIngestionSourceCommandSchema,
  ingestionKeyMintCommandSchema,
} from "../src/index";

describe("governance ingestion contracts", () => {
  it("rejects transport values outside the canonical source vocabulary", () => {
    expect(() =>
      createGovernanceIngestionSourceCommandSchema.parse({
        organizationId: "org-1",
        sourceType: "made_up",
        name: "source",
        actorUserId: "user-1",
      }),
    ).toThrow();
  });

  it("rejects unsafe activity pagination and sort values", () => {
    expect(() =>
      activityMonitorPagedWindowQuerySchema.parse({
        organizationId: "org-1",
        windowDays: 30,
        offset: -1,
        sortBy: "drop table",
      }),
    ).toThrow();
  });

  it("keeps ingestion key ownership explicit", () => {
    expect(
      ingestionKeyMintCommandSchema.parse({
        callerUserId: "caller-1",
        ownerUserId: null,
        organizationId: "org-1",
        projectId: "project-1",
        sourceType: "claude_code",
      }),
    ).toMatchObject({ ownerUserId: null, projectId: "project-1" });
  });
});
