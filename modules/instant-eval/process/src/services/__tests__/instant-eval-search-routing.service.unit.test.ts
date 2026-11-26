/**
 * Whether a project's judged queries send the search route: its own flag (ADR-190 decision 13).
 * @see specs/lwql/eval-functions.feature
 */
import { describe, expect, it, vi } from "vitest";

import { InstantEvalSearchRoutingService } from "../instant-eval-search-routing.service.ts";

function routingWith({
  isOn,
  organizationId,
}: {
  isOn: boolean;
  organizationId: string | undefined;
}) {
  const isEnabled = vi.fn(async () => isOn);
  const routing = InstantEvalSearchRoutingService.create({
    flags: { isEnabled },
    projects: { findOrganizationId: async () => organizationId },
  });
  return { routing, isEnabled };
}

describe("InstantEvalSearchRoutingService", () => {
  /** @scenario "With the search router flag on a judged query is routed under its cost ceiling" */
  it("reads its own flag for the project within its organization", async () => {
    const { routing, isEnabled } = routingWith({ isOn: true, organizationId: "org-1" });

    expect(await routing.isRouted({ projectId: "project-1" })).toBe(true);
    expect(isEnabled).toHaveBeenCalledWith("release_instant_evals_search_router", {
      kind: "project",
      projectId: "project-1",
      organizationId: "org-1",
    });
  });

  /** @scenario "With the search router flag off a judged query sends no route" */
  it("is off where the flag is off", async () => {
    const { routing } = routingWith({ isOn: false, organizationId: "org-1" });

    expect(await routing.isRouted({ projectId: "project-1" })).toBe(false);
  });

  /** @scenario "With the search router flag off a judged query sends no route" */
  it("is off for a project in no organization, without reading the flag", async () => {
    const { routing, isEnabled } = routingWith({ isOn: true, organizationId: undefined });

    expect(await routing.isRouted({ projectId: "project-1" })).toBe(false);
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
