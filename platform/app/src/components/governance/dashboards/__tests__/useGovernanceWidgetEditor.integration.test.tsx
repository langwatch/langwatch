/**
 * @vitest-environment jsdom
 *
 * The Run button behind a governance widget's Query button.
 *
 * The page test covers what a reader sees; this covers the one thing a reader
 * can reach from in there that the page test cannot easily stage — a statement
 * that DECLARES a parameter. The Queries tab lets a reader add one, and a
 * declared parameter changes what a Run is allowed to do.
 *
 * Spec: specs/governance/governance-dashboards.feature
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceWidget } from "../governanceWidgets";
import { useGovernanceWidgetEditor } from "../useGovernanceWidgetEditor";

function widgetDeclaringAParameter(): GovernanceWidget {
  return {
    id: "department",
    name: "Cost by department",
    definition: {
      code: "export default function Chart() { return null; }",
      queries: [
        {
          name: "department",
          query: "SELECT 1 WHERE dept = {{ department }}",
          // Declared, required, and with no default — so there is no value a
          // standalone Run could supply for it.
          parameters: [{ name: "department", type: "string" }],
        },
      ],
    },
  } as unknown as GovernanceWidget;
}

describe("given a statement that declares a parameter", () => {
  /** @scenario "Running a statement in the editor answers from the invented figures" */
  it("refuses the run through the shared check rather than asking with nothing", async () => {
    const executeQuery = vi.fn().mockResolvedValue({ columns: [], rows: [] });
    const widget = widgetDeclaringAParameter();

    const { result } = renderHook(() =>
      useGovernanceWidgetEditor({ widget, executeQuery, onSave: vi.fn() }),
    );

    act(() => result.current.open());
    await act(async () => {
      await result.current.run(widget.definition.queries[0]!);
    });

    await waitFor(() =>
      expect(result.current.lastRuns.department?.error).toBeDefined(),
    );

    // The one gate every other Run in the product goes through decides this,
    // so a governance widget cannot validate differently from a real one.
    expect(result.current.lastRuns.department?.error?.code).toBe(
      "dashboard_widget_query_missing_param",
    );
    // And nothing was asked, because there was nothing valid to ask.
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
