// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { NumericMode } from "../../../../../behavior/numeric-mode.store.ts";
import { FacetManagerPopover } from "../facet-manager-popover.tsx";

const LABELS: Record<string, string> = {
  model: "Model",
  "metadata.team": "Team",
  "metric.cost": "Cost",
};

function renderPopover({ visible = ["model"] }: { visible?: string[] } = {}) {
  const calls: string[] = [];
  render(
    <ChakraProvider value={defaultSystem}>
      <FacetManagerPopover
        open
        orderedKeysAll={Object.keys(LABELS)}
        sectionByKey={new Map(Object.entries(LABELS).map(([k, label]) => [k, { label }]))}
        isVisible={(key) => visible.includes(key)}
        onShow={(key) => calls.push(`show:${key}`)}
        onHide={(key) => calls.push(`hide:${key}`)}
        onResetAll={() => calls.push("reset")}
        numericModeByKey={new Map<string, NumericMode>([["metric.cost", "range"]])}
        setNumericMode={({ field, mode }) => calls.push(`mode:${field}:${mode}`)}
      />
    </ChakraProvider>,
  );
  return calls;
}

/** The clickable row around a facet's checkbox. */
const rowOf = (label: string) =>
  screen.getByRole("checkbox", { name: label }).closest("label")!.parentElement!;

describe("FacetManagerPopover facet list", () => {
  afterEach(cleanup);

  it("lists every facet with its checked state and toggles it both ways", () => {
    const calls = renderPopover();

    expect(screen.getByRole("checkbox", { name: "Model" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Team" })).not.toBeChecked();
    fireEvent.click(rowOf("Model"));
    fireEvent.click(rowOf("Team"));

    expect(calls).toEqual(["hide:model", "show:metadata.team"]);
  });

  it("offers the range/discrete picker only on numeric facets that support both", () => {
    const calls = renderPopover();

    const range = screen.getByRole("button", { name: "Range" });
    const discrete = screen.getByRole("button", { name: "Discrete" });
    expect(range).toHaveAttribute("aria-pressed", "true");
    expect(discrete).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { name: "Range" })).toHaveLength(1);
    fireEvent.click(discrete);

    expect(calls).toEqual(["mode:metric.cost:discrete"]);
    expect(screen.getAllByRole("button", { name: "Discrete" })).toHaveLength(1);
  });

  it("filters by label or key, and says so when nothing matches", () => {
    renderPopover();
    const filter = screen.getByPlaceholderText("Filter facets…");

    fireEvent.change(filter, { target: { value: "metadata.te" } });
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Model" })).toBeNull();

    fireEvent.change(filter, { target: { value: "nothing-like-this" } });
    expect(screen.getByText(/No facets match/)).toBeInTheDocument();
  });
});
