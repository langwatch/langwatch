// @vitest-environment jsdom
/**
 * ADR-144: rows on an aggregate project come from several member projects,
 * so its trace table names the member each row was listed from. A plain
 * project's table, and every lens and column picker, never carry the column.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { memberProjectName } from "../../../hooks/useMemberProjectName";
import { allTraceColumnIds, MEMBER_PROJECT_COLUMN_ID } from "../columns";
import { ProjectCell } from "../registry/cells/trace/ProjectCell";
import { useTraceLensColumns } from "../useTraceLensColumns";

const LENS = ["time", "trace", "service"];

describe("the member project column", () => {
  describe("when the open project is an aggregate", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("comes first after the select column, with its cell", () => {
      const { result } = renderHook(() =>
        useTraceLensColumns({
          logicalColumnIds: LENS,
          showMemberProject: true,
        }),
      );

      const ids = result.current.columns.map((column) => column.id);
      expect(ids.indexOf(MEMBER_PROJECT_COLUMN_ID)).toBe(1);
      expect(result.current.registry.cells[MEMBER_PROJECT_COLUMN_ID]).toBe(
        ProjectCell,
      );
    });
  });

  describe("when the open project is a plain one", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("is absent", () => {
      const { result } = renderHook(() =>
        useTraceLensColumns({ logicalColumnIds: LENS }),
      );

      const ids = result.current.columns.map((column) => column.id);
      expect(ids).not.toContain(MEMBER_PROJECT_COLUMN_ID);
      expect(
        result.current.registry.cells[MEMBER_PROJECT_COLUMN_ID],
      ).toBeUndefined();
    });

    it("is not a column any lens or picker offers", () => {
      expect(allTraceColumnIds).not.toContain(MEMBER_PROJECT_COLUMN_ID);
    });
  });
});

describe("memberProjectName", () => {
  const projects = [
    { id: "project_support", name: "Support Bot" },
    { id: "project_billing", name: "Billing Agent" },
  ];

  describe("when the member is among the viewer's projects", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("names it", () => {
      expect(
        memberProjectName({ projectId: "project_billing", projects }),
      ).toBe("Billing Agent");
    });
  });

  describe("when the member is not among them", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("falls back to its id", () => {
      expect(
        memberProjectName({ projectId: "project_unknown", projects }),
      ).toBe("project_unknown");
    });
  });
});
