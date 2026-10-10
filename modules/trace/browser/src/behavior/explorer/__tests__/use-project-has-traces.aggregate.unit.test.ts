/**
 * An aggregate is never sent a trace and reads its members', so it never shows onboarding.
 * @see specs/governance/aggregate-project.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectRef } = vi.hoisted(() => ({
  projectRef: {
    current: undefined as { id: string; firstMessage?: boolean; kind?: string } | undefined,
  },
}));

vi.mock("../../use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: projectRef.current, isLoading: false }),
}));

import { useProjectHasTraces } from "../use-project-has-traces.ts";

describe("useProjectHasTraces", () => {
  beforeEach(() => {
    projectRef.current = undefined;
  });

  describe("when the project is an aggregate that was never sent a trace", () => {
    /** @scenario "Aggregate Trace Explorer shows member rows without onboarding" */
    it("counts as having traces", () => {
      projectRef.current = { id: "project-aggregate", firstMessage: false, kind: "aggregate" };

      expect(useProjectHasTraces().hasAnyTraces).toBe(true);
    });
  });

  describe("when a plain project was never sent a trace", () => {
    it("counts as having none", () => {
      projectRef.current = { id: "project-1", firstMessage: false, kind: "application" };

      expect(useProjectHasTraces().hasAnyTraces).toBe(false);
    });
  });
});
