/**
 * The page the user is on is offered as context, read off the route.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-context-system.feature
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../tools/ui/sections/langy-page-context.tsx", () => ({
  useLangy: () => ({ experimentSlug: undefined, pageContext: [] }),
}));

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import { removeContextChip } from "../../../../context-target/behavior/langy-context-target.store.ts";
import { langyTurnContext } from "../../../behavior/panel/use-langy-panel-transport.ts";
import { useLangyPageContext } from "../use-langy-page-context.ts";

function pageContextAt(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
  return renderHook(() => useLangyPageContext(), { wrapper }).result;
}

function offeredAt(path: string) {
  return pageContextAt(path).current.addableChips;
}

beforeEach(() => {
  useLangyStore.getState().resetChosenChips();
});

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

  /** @scenario "Only a dashboard attaches itself; other pages still only offer their context" */
  it("attaches nothing on a trace, an experiment or a dataset until the user chooses", () => {
    for (const path of [
      "/demo/traces/trace_abc123",
      "/demo/experiments/checkout-eval",
      "/demo/datasets/ds_42",
    ]) {
      expect(pageContextAt(path).current.chips).toEqual([]);
    }
  });
});

describe("given the user is viewing a dashboard", () => {
  /** @scenario "Viewing a dashboard attaches that board as context without a click" */
  it("attaches the board, carrying its id, to the context every turn sends", () => {
    const { chips, addableChips } = pageContextAt("/demo/dashboards/dash_42").current;

    expect(chips).toContainEqual(
      expect.objectContaining({ id: "dashboard:dash_42", kind: "dashboard", ref: "dash_42" }),
    );
    expect(addableChips.map((chip) => chip.kind)).not.toContain("dashboard");
    const turn = langyTurnContext({
      projectId: "project-test",
      conversationId: null,
      pendingConversationId: null,
      modelOverride: "",
      chips,
    });
    expect(turn.pageContext).toContainEqual(
      expect.objectContaining({ kind: "dashboard", ref: "dash_42" }),
    );
  });

  /** @scenario "A removed dashboard chip stays removed and can be added back" */
  it("drops the board on the chip's remove, offers it back, and re-attaches it on add", () => {
    const result = pageContextAt("/demo/dashboards/dash_42");
    expect(result.current.chips.map((chip) => chip.kind)).toContain("dashboard");

    act(() => removeContextChip("dashboard:dash_42"));
    expect(result.current.chips.map((chip) => chip.kind)).not.toContain("dashboard");
    expect(result.current.addableChips).toContainEqual(
      expect.objectContaining({ id: "dashboard:dash_42" }),
    );

    act(() => useLangyStore.getState().chooseChip("dashboard:dash_42"));
    expect(result.current.chips).toContainEqual(
      expect.objectContaining({ id: "dashboard:dash_42" }),
    );
  });
});

describe("given the user is on a dashboards page that shows no one board", () => {
  /** @scenario "Dashboard pages that show no one board offer no board as context" */
  it("attaches and offers no dashboard chip on the list, the templates library or a curated board", () => {
    for (const path of [
      "/demo/dashboards",
      "/demo/dashboards/templates",
      "/demo/dashboards/curated/agent-health",
    ]) {
      const { chips, addableChips } = pageContextAt(path).current;
      expect([...chips, ...addableChips].map((chip) => chip.kind)).not.toContain("dashboard");
    }
  });
});
