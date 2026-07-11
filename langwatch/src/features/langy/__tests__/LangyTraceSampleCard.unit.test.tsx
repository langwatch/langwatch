/**
 * @vitest-environment jsdom
 *
 * The card's job is to show a SAMPLE without ever letting the sample pass for
 * the whole result — and to offer a way through to that whole result that lands
 * on the same question the agent asked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LangyTraceSampleCard } from "../components/capabilities/LangyTraceSampleCard";
import type { CapabilityDescriptor } from "../components/capabilities/capabilityRegistry";

const descriptor: CapabilityDescriptor = {
  render: "traceSample",
  tone: "read",
  surface: "traces",
  overline: "Traces",
};

const command =
  "langwatch trace search --query 'checkout' --start-date 1750000000000 --end-date 1750086400000 --limit 25 --format json";

function trace(id: string, startedAt: number) {
  return {
    trace_id: id,
    timestamps: { started_at: startedAt },
    input: { value: `question ${id}` },
    metrics: { total_time_ms: 1240, total_cost: 0.0041 },
  };
}

function renderCard({
  totalHits,
  count,
}: {
  totalHits: number;
  count: number;
}) {
  const traces = Array.from({ length: count }, (_, i) =>
    trace(`trace_${i}`, 1750000000000 + i),
  );
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyTraceSampleCard
        descriptor={descriptor}
        input={{ command }}
        output={{ traces, pagination: { totalHits } }}
        projectSlug="acme"
      />
    </ChakraProvider>,
  );
}

describe("LangyTraceSampleCard", () => {
  describe("given a search that matched far more traces than it returned", () => {
    describe("when the card renders", () => {
      it("says how many were found AND how many it is showing", () => {
        renderCard({ totalHits: 34, count: 25 });

        expect(screen.getByText("34 traces · showing 3")).toBeTruthy();
      });

      it("shows only a sample, not the whole returned page", () => {
        renderCard({ totalHits: 34, count: 25 });

        expect(screen.getAllByText(/^question trace_/)).toHaveLength(3);
      });

      it("points at the rest rather than pretending they aren't there", () => {
        renderCard({ totalHits: 34, count: 25 });

        expect(screen.getByText("31 more in the Trace Explorer")).toBeTruthy();
      });
    });
  });

  describe("given the sample IS the whole result", () => {
    describe("when the card renders", () => {
      it("drops the qualifier instead of saying 'showing 2' of 2", () => {
        renderCard({ totalHits: 2, count: 2 });

        expect(screen.getByText("2 traces")).toBeTruthy();
        expect(screen.queryByText(/showing/)).toBeNull();
      });
    });
  });

  describe("given the search matched nothing", () => {
    describe("when the card renders", () => {
      it("reads as a real answer, not as a failure", () => {
        renderCard({ totalHits: 0, count: 0 });

        expect(screen.getByText("No traces matched.")).toBeTruthy();
      });
    });
  });

  describe("given the user wants the full result set", () => {
    describe("when they follow 'View in Trace Explorer'", () => {
      it("carries the agent's query and window into the Explorer's URL", () => {
        renderCard({ totalHits: 34, count: 25 });

        const link = screen
          .getByText("View in Trace Explorer")
          .closest("a") as HTMLAnchorElement;

        expect(link.getAttribute("href")).toBe(
          "/acme/traces#all-traces?q=%22checkout%22&from=1750000000000&to=1750086400000",
        );
      });
    });

    describe("when they click one of the sampled traces", () => {
      it("opens that trace's drawer — the same one the trace table opens", () => {
        renderCard({ totalHits: 34, count: 25 });

        const row = screen
          .getByText("question trace_0")
          .closest("a") as HTMLAnchorElement;
        const href = row.getAttribute("href")!;

        expect(href).toContain("drawer.open=traceV2Details");
        expect(href).toContain("drawer.traceId=trace_0");
        // The search rides along, so closing the drawer leaves the right result
        // set behind it rather than a naked explorer.
        expect(href).toContain("q=%22checkout%22");
      });
    });
  });
});
