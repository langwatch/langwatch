import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { describe, expect, it, vi } from "vitest";

import { EvaluationJudgeRoutingService } from "../evaluation-judge-routing.service.ts";

function buildRouting({ organizationId }: { organizationId: string | undefined }) {
  const isEnabled = vi.fn<FeatureFlagApi["isEnabled"]>().mockResolvedValue(true);
  const routing = EvaluationJudgeRoutingService.create({
    flags: { isEnabled },
    projects: { findOrganizationId: async () => organizationId },
  });
  return { routing, isEnabled };
}

describe("EvaluationJudgeRoutingService", () => {
  /** @scenario "An LLM judge on LangWatch Evals Preview is routed when the flag is on" */
  it("reads the router flag for the project within its organization", async () => {
    const { routing, isEnabled } = buildRouting({ organizationId: "org-1" });

    await expect(routing.isRouted({ projectId: "proj-1" })).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith("release_instant_evals_judge_router", {
      kind: "project",
      projectId: "proj-1",
      organizationId: "org-1",
    });
  });

  it("never routes a project with no organization", async () => {
    const { routing, isEnabled } = buildRouting({ organizationId: undefined });

    await expect(routing.isRouted({ projectId: "proj-1" })).resolves.toBe(false);
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
