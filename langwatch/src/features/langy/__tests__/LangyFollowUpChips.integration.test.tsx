/**
 * @vitest-environment jsdom
 *
 * Follow-up suggestions, wired through the capability renderer.
 *
 * A capability card answers "what did Langy find"; the chip row beneath it
 * answers "what do I do with it". These tests render the real renderer over a
 * settled trace search and assert the offers land as quiet navigation chips —
 * and that a search worth no next step shows no row at all.
 *
 * Spec: specs/langy/langy-followup-suggestions.feature
 *
 * Boundary mock: useOrganizationTeamProject (project slug for deep links). No
 * DB, no network — the offers are derived from the feature map and the tool
 * call alone.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p_demo", slug: "demo" } }),
}));

import { LangyCapabilityRenderer } from "../components/capabilities/LangyCapabilityRenderer";

afterEach(cleanup);

/** A settled trace search carrying a structured error filter over the last day. */
function traceSearch(
  over: { name?: string; state?: string; output?: unknown } = {},
) {
  return {
    name: over.name ?? "langwatch.trace.search",
    state: over.state ?? "output-available",
    input: { filters: { "traces.error": ["true"] }, startDate: "24h" },
    output:
      over.output ??
      JSON.stringify({
        traces: [{ trace_id: "trace_1", input: { value: "checkout failed" } }],
        pagination: { totalHits: 1 },
      }),
  };
}

function renderCall(call: {
  name: string;
  state: string;
  input: unknown;
  output: unknown;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyCapabilityRenderer call={call} />
    </ChakraProvider>,
  );
}

const chipRow = () =>
  screen.queryByRole("navigation", { name: "Suggested next steps" });

describe("LangyCapabilityRenderer follow-up chips", () => {
  describe("given a trace search that found traces", () => {
    describe("when the card renders", () => {
      it("offers to graph the search, filtered to what it found", () => {
        renderCall(traceSearch());

        const row = chipRow()!;
        const graph = within(row)
          .getByText("Graph these")
          .closest("a") as HTMLAnchorElement;

        expect(graph.getAttribute("href")).toBe(
          "/demo/analytics/custom?has_error=true",
        );
      });

      it("offers to alert on the search, filtered to what it found", () => {
        renderCall(traceSearch());

        const row = chipRow()!;
        const alert = within(row)
          .getByText("Alert me on this")
          .closest("a") as HTMLAnchorElement;

        expect(alert.getAttribute("href")).toBe(
          "/demo/messages?has_error=true&drawer.open=automation",
        );
      });

      it("drops the offers no destination can carry (dataset, annotation)", () => {
        renderCall(traceSearch());

        const row = chipRow()!;
        expect(within(row).queryByText("Add to a dataset")).toBeNull();
        expect(within(row).queryByText("Send for annotation")).toBeNull();
      });
    });
  });

  describe("given a search that matched nothing", () => {
    describe("when the card renders", () => {
      it("shows no suggestion row — there is no 'these' to act on", () => {
        renderCall(
          traceSearch({
            output: JSON.stringify({
              traces: [],
              pagination: { totalHits: 0 },
            }),
          }),
        );

        expect(chipRow()).toBeNull();
      });
    });
  });

  describe("given a search that failed", () => {
    describe("when the card renders", () => {
      it("shows no suggestion row for an unsettled result", () => {
        renderCall(traceSearch({ state: "output-error", output: "not found" }));

        expect(chipRow()).toBeNull();
      });
    });
  });
});
