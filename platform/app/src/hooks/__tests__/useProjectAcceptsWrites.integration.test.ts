/**
 * @vitest-environment jsdom
 *
 * The one client rule for whether a control may offer a write under the
 * current project: an aggregate is read only (ADR-144 decision 8), every other
 * project takes writes.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectAcceptsWrites } from "../useProjectAcceptsWrites";

const { projectRef } = vi.hoisted(() => ({
  projectRef: {
    current: undefined as { id: string; kind: string } | undefined,
  },
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: projectRef.current }),
}));

describe("useProjectAcceptsWrites()", () => {
  describe("when the project is an aggregate", () => {
    it("refuses writes", () => {
      projectRef.current = { id: "agg-1", kind: "aggregate" };

      const { result } = renderHook(() => useProjectAcceptsWrites());

      expect(result.current).toBe(false);
    });
  });

  describe("when the project is an ordinary one", () => {
    it("accepts writes", () => {
      projectRef.current = { id: "proj-1", kind: "application" };

      const { result } = renderHook(() => useProjectAcceptsWrites());

      expect(result.current).toBe(true);
    });
  });

  describe("when no project has loaded yet", () => {
    it("accepts writes, as an ordinary project would", () => {
      projectRef.current = undefined;

      const { result } = renderHook(() => useProjectAcceptsWrites());

      expect(result.current).toBe(true);
    });
  });
});
