import { describe, expect, it } from "vitest";
import {
  codingAgentRecentSessionsInputSchema,
  codingAgentSessionSchema,
  codingAgentUsageTotalsSchema,
} from "../index";

describe("coding-agent contract", () => {
  it("keeps GitHub's session-branch facts and the complete aggregate row portable", () => {
    const keys = codingAgentSessionSchema.keyof().options;
    expect(keys).toContain("repositoryHost");
    expect(keys).toContain("repositoryOwner");
    expect(keys).toContain("repositoryName");
    expect(keys).toContain("gitBranch");
    expect(keys).toContain("gitBranches");
    expect(keys).toContain("lastEventOccurredAt");
    expect(keys).toContain("metricSeries");
  });

  it("validates the existing list and usage inputs at the service boundary", () => {
    expect(
      codingAgentRecentSessionsInputSchema.parse({
        projectId: "project-1",
        fromMs: 1,
        toMs: 2,
        limit: 50,
      }),
    ).toMatchObject({ projectId: "project-1", limit: 50 });
    expect(
      codingAgentUsageTotalsSchema.parse({
        sessionCount: 1,
        costUsd: 0,
        totalTokens: 0,
        activeTimeSec: 0,
        linesAdded: 0,
        linesRemoved: 0,
        commits: 0,
        pullRequests: 0,
      }),
    ).toMatchObject({ sessionCount: 1 });
  });
});
