/**
 * The page the user is on is offered as context, read off the route.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-context-system.feature
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../tools/ui/sections/langy-page-context.tsx", () => ({
  useLangy: () => ({ experimentSlug: undefined, pageContext: [] }),
}));

import { useLangyPageContext } from "../use-langy-page-context.ts";

function offeredAt(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
  return renderHook(() => useLangyPageContext(), { wrapper }).result.current.addableChips;
}

describe("given the user is viewing one resource", () => {
  /** @scenario "Viewing an experiment surfaces it as context" */
  it("offers a chip for the experiment, workbench route included", () => {
    for (const path of [
      "/demo/experiments/checkout-eval",
      "/demo/experiments/workbench/checkout-eval",
    ]) {
      expect(offeredAt(path)).toContainEqual(
        expect.objectContaining({ kind: "experiment", ref: "checkout-eval" }),
      );
    }
  });

  /** @scenario "Viewing a trace surfaces it as context" */
  it("offers a chip for the trace", () => {
    const chips = offeredAt("/demo/traces/trace_abc123");
    expect(chips).toContainEqual(expect.objectContaining({ kind: "trace" }));
    expect(chips.map((chip) => chip.id).join(" ")).toContain("trace_abc123");
  });

  /** @scenario "Viewing a prompt, dataset, or dashboard surfaces it as context" */
  it("offers a chip for the dataset", () => {
    const chips = offeredAt("/demo/datasets/ds_42");
    expect(chips).toContainEqual(expect.objectContaining({ kind: "dataset" }));
    expect(chips.map((chip) => chip.id).join(" ")).toContain("ds_42");
  });

  /** @scenario "Viewing a dashboard surfaces that board as context" */
  it("offers a chip for the dashboard, carrying its id", () => {
    expect(offeredAt("/demo/dashboards/dash_42")).toContainEqual(
      expect.objectContaining({ id: "dashboard:dash_42", kind: "dashboard", ref: "dash_42" }),
    );
  });
});

describe("given the user is on a dashboards page that shows no one board", () => {
  /** @scenario "Dashboard pages that show no one board offer no board as context" */
  it("offers no dashboard chip on the list, the templates library or a curated board", () => {
    for (const path of [
      "/demo/dashboards",
      "/demo/dashboards/templates",
      "/demo/dashboards/curated/agent-health",
    ]) {
      expect(offeredAt(path).map((chip) => chip.kind)).not.toContain("dashboard");
    }
  });
});
