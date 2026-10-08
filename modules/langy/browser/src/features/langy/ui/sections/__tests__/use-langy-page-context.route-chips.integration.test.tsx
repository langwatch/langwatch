/**
 * The page the user is on is offered as context, read off the route. Unbound: the spec says the
 * composer shows the chip, but a route chip is only offered until chosen (see the lane handoff).
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

  it("offers a chip for the trace", () => {
    const chips = offeredAt("/demo/traces/trace_abc123");
    expect(chips).toContainEqual(expect.objectContaining({ kind: "trace" }));
    expect(chips.map((chip) => chip.id).join(" ")).toContain("trace_abc123");
  });

  it("offers a chip for the dataset", () => {
    const chips = offeredAt("/demo/datasets/ds_42");
    expect(chips).toContainEqual(expect.objectContaining({ kind: "dataset" }));
    expect(chips.map((chip) => chip.id).join(" ")).toContain("ds_42");
  });
});
