import { describe, expect, it } from "vitest";

import { projectSpendRollupSchema } from "../entitlement.schemas.ts";

describe("projectSpendRollupSchema", () => {
  /** @scenario "Spend rollups never carry project credentials" */
  it("keeps the project's identity and drops every other column", () => {
    const read = projectSpendRollupSchema.parse({
      project: {
        id: "project_1",
        name: "Chat",
        slug: "chat",
        teamId: "team_1",
        apiKey: "stored-key",
        lwqlKey: "stored-query-key",
        s3AccessKeyId: "stored-access",
        s3SecretAccessKey: "stored-secret",
      },
      costs: [],
    });

    expect(read.project).toEqual({ id: "project_1", name: "Chat", slug: "chat", teamId: "team_1" });
  });
});
