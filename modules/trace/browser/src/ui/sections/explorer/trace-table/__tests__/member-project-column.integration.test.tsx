// @vitest-environment jsdom
/**
 * ADR-177: an aggregate's trace table names the member project each row was listed from;
 * a plain project's table, and every lens and column picker, never carry the column.
 * @see specs/governance/aggregate-project.feature
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { TraceHostApi, TraceHostProvider } from "../../../../../behavior/trace-host.ts";
import { useMemberProjectName } from "../../hooks/use-member-project-name.ts";
import { allTraceColumnIds, MEMBER_PROJECT_COLUMN_ID } from "../columns.ts";
import { ProjectCell } from "../registry/cells/trace/project-cell.tsx";
import { useTraceLensColumns } from "../use-trace-lens-columns.ts";

const LENS = ["time", "trace", "service"];

/** A host that knows the viewer's projects by name, as the mount's scope read does. */
class NamingTraceHost extends TraceHostApi {
  private readonly names = new Map([
    ["project_support", "Support Bot"],
    ["project_billing", "Billing Agent"],
  ]);

  project() {
    return { id: "project_agg", slug: "agg", name: "Aggregate" };
  }
  organization() {
    return void 0;
  }
  team() {
    return void 0;
  }
  organizationRole() {
    return void 0;
  }
  currentUser() {
    return void 0;
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  override projectName(projectId: string) {
    return this.names.get(projectId);
  }
  route() {
    return { params: {}, query: {}, pathname: "/agg/traces" };
  }
  setQuery() {}
  navigate() {}
  succeeded() {}
  failed() {}
  registerLangyActions() {
    return () => {};
  }
  askLangy() {}
}

const host = new NamingTraceHost();
const wrapper = ({ children }: { children: ReactNode }) => (
  <TraceHostProvider value={host}>{children}</TraceHostProvider>
);

describe("the member project column", () => {
  describe("when the open project is an aggregate", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("comes first after the select column, with its cell", () => {
      const { result } = renderHook(() =>
        useTraceLensColumns({ logicalColumnIds: LENS, showMemberProject: true }),
      );

      const ids = result.current.columns.map((column) => column.id);
      expect(ids.indexOf(MEMBER_PROJECT_COLUMN_ID)).toBe(1);
      expect(result.current.registry.cells[MEMBER_PROJECT_COLUMN_ID]).toBe(ProjectCell);
    });
  });

  describe("when the open project is a plain one", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("is absent", () => {
      const { result } = renderHook(() => useTraceLensColumns({ logicalColumnIds: LENS }));

      const ids = result.current.columns.map((column) => column.id);
      expect(ids).not.toContain(MEMBER_PROJECT_COLUMN_ID);
      expect(result.current.registry.cells[MEMBER_PROJECT_COLUMN_ID]).toBeUndefined();
    });

    it("is not a column any lens or picker offers", () => {
      expect(allTraceColumnIds).not.toContain(MEMBER_PROJECT_COLUMN_ID);
    });
  });
});

describe("useMemberProjectName()", () => {
  describe("when the member is among the viewer's projects", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("names it", () => {
      const { result } = renderHook(() => useMemberProjectName("project_billing"), { wrapper });

      expect(result.current).toBe("Billing Agent");
    });
  });

  describe("when the member is not among them", () => {
    /** @scenario "Each aggregate row names its member project" */
    it("falls back to its id", () => {
      const { result } = renderHook(() => useMemberProjectName("project_unknown"), { wrapper });

      expect(result.current).toBe("project_unknown");
    });
  });

  describe("when no host is mounted (the shared page)", () => {
    it("falls back to its id", () => {
      const { result } = renderHook(() => useMemberProjectName("project_billing"));

      expect(result.current).toBe("project_billing");
    });
  });
});
