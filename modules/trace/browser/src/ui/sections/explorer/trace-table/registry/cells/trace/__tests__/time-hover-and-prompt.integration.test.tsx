/**
 * @vitest-environment jsdom
 *
 * The read-only timestamp breakdown a time cell reveals on hover, and what a
 * click on the prompt chip does.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExplorerStore } from "../../../../../../../../behavior/explorer.store.ts";
import { formatISOTimestamp } from "../../../../../../../../model/display-formatters.ts";
import { useDensityTokens } from "../../../../../hooks/use-density-tokens.ts";
import type { TraceListItem } from "../../../../../types/trace.ts";
import { buildTracePlaceholderRows } from "../../../../skeleton-placeholders.ts";
import type { CellDef } from "../../../types.ts";
import { PromptCell } from "../prompt-cell.tsx";
import { TimeCell } from "../time-cell.tsx";
import "@testing-library/jest-dom/vitest";

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));
vi.mock("../../../../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1", slug: "acme" } }),
}));
vi.mock("../../../../../../../../behavior/reads/use-project-reads.ts", () => ({
  usePromptsForProject: () => ({
    data: [{ id: "prompt_abc", handle: "support-bot", name: "Support bot" }],
  }),
}));

function row(over: Partial<TraceListItem> = {}): TraceListItem {
  const [placeholder] = buildTracePlaceholderRows(1);
  if (!placeholder) throw new Error("no placeholder row built");
  return { ...placeholder, traceId: "t1", ...over };
}

const Cell: React.FC<{ def: CellDef<TraceListItem>; item: TraceListItem }> = ({ def, item }) => (
  <table>
    <tbody>
      <tr>
        <td>
          {def.render({
            row: item,
            density: useDensityTokens(),
            densityMode: "compact",
            isExpanded: false,
            isSelected: false,
            isFocused: false,
            actions: {},
            enabledAddonIds: [],
          })}
        </td>
      </tr>
    </tbody>
  </table>
);

beforeEach(() => {
  useExplorerStore.getState().clearAll();
});

afterEach(cleanup);

describe("hovering a time cell", () => {
  /** @scenario "Hovering a time cell shows a read-only breakdown" */
  it("shows the relative, local, UTC and ISO forms and offers nothing to change the format", async () => {
    const timestamp = Date.now() - 120_000;
    renderWithDesignSystem(<Cell def={TimeCell} item={row({ timestamp })} />);

    await userEvent.hover(screen.getByText("2m"));

    const card = (await screen.findByText("Local")).closest("[data-part='content']") as HTMLElement;
    expect(card).not.toBeNull();
    for (const label of ["Local", "UTC", "ISO"]) {
      expect(within(card).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(card).getByText(formatISOTimestamp(timestamp))).toBeInTheDocument();
    expect(within(card).getByText(/2 minutes ago/)).toBeInTheDocument();
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryAllByRole("radio")).toHaveLength(0);
    expect(within(card).queryAllByRole("menuitem")).toHaveLength(0);
  });
});

describe("clicking the prompt chip", () => {
  /** @scenario "Clicking a prompt chip filters by that prompt" */
  it("toggles the lastUsedPrompt facet for that prompt", async () => {
    renderWithDesignSystem(<Cell def={PromptCell} item={row({ promptId: "prompt_abc" })} />);
    expect(useExplorerStore.getState().queryText).toBe("");

    await userEvent.click(screen.getByRole("button", { name: 'Filter by prompt "support-bot"' }));

    expect(useExplorerStore.getState().queryText).toContain("prompt_abc");
  });
});
