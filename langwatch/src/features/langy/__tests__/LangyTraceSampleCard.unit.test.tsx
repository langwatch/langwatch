/**
 * @vitest-environment jsdom
 *
 * The card's job is to show a SAMPLE without ever letting the sample pass for
 * the whole result — and to offer a way through to that whole result that lands
 * on the same question the agent asked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { CliResultDigest } from "@langwatch/langy";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityData } from "../hooks/useCapabilityData";
import { LangyTraceSampleCard } from "../components/capabilities/LangyTraceSampleCard";
import { resolveCapability } from "../components/capabilities/capabilityRegistry";

// The hydration seam is mocked: these tests pin the card's RENDERING of each
// hydration state (fresh rows, skeletons, gone, fallback), not the fetching —
// the hook's own resolution rules live in useCapabilityData.unit.test.tsx.
const idleData: CapabilityData = {
  status: "idle",
  rows: [],
  loadedCount: 0,
  totalCount: null,
  isHydrating: false,
};
const useCapabilityDataMock = vi.fn((): CapabilityData => idleData);
vi.mock("../hooks/useCapabilityData", () => ({
  useCapabilityData: () => useCapabilityDataMock(),
}));

beforeEach(() => {
  useCapabilityDataMock.mockReturnValue(idleData);
});

const descriptor = resolveCapability("langwatch.trace.search")!;

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

  describe("given output the card cannot read", () => {
    // e.g. the JSON was truncated upstream (8KB tool-output cap) so it parses
    // as neither the contract document nor anything with rows in it.
    const renderUnreadable = () =>
      render(
        <ChakraProvider value={defaultSystem}>
          <LangyTraceSampleCard
            descriptor={descriptor}
            input={{ command }}
            output={'{"traces":[{"trace_id":"trace_1","input":{"va'}
            projectSlug="acme"
          />
        </ChakraProvider>,
      );

    describe("when the card renders", () => {
      it("owns the failure instead of claiming zero traces matched", () => {
        renderUnreadable();

        expect(screen.getByText(/Couldn.t read this result/)).toBeTruthy();
        expect(screen.queryByText("No traces matched.")).toBeNull();
        expect(screen.queryByText(/0 traces/)).toBeNull();
      });

      it("still offers the way through to the Trace Explorer", () => {
        renderUnreadable();

        expect(screen.getByText("View in Trace Explorer")).toBeTruthy();
      });
    });
  });

  describe("given the result's references hydrate fresh data", () => {
    const digest: CliResultDigest = {
      resource: "trace",
      verb: "search",
      strategy: "id-ref",
      ids: ["trace_a", "trace_b"],
      counts: { returned: 2, total: 34 },
    };

    const renderHydrated = () =>
      render(
        <ChakraProvider value={defaultSystem}>
          <LangyTraceSampleCard
            descriptor={descriptor}
            input={{ command }}
            output=""
            digest={digest}
            projectSlug="acme"
          />
        </ChakraProvider>,
      );

    describe("when the hydrated rows arrive", () => {
      it("renders the current data with honest counts, not the stored output", () => {
        useCapabilityDataMock.mockReturnValue({
          status: "hydrated",
          rows: [
            {
              id: "trace_a",
              primary: "question trace_a",
              secondary: "2 Jul 14:03 · 1.2s",
              timestamp: 1750000000000,
            },
            {
              id: "trace_b",
              primary: "question trace_b",
              secondary: "2 Jul 14:04 · 0.8s",
              timestamp: 1750000001000,
            },
          ],
          loadedCount: 2,
          totalCount: 34,
          isHydrating: false,
        });
        renderHydrated();

        expect(screen.getByText("34 traces · showing 2")).toBeTruthy();
        expect(screen.getByText("question trace_a")).toBeTruthy();
        const row = screen
          .getByText("question trace_a")
          .closest("a") as HTMLAnchorElement;
        expect(row.getAttribute("href")).toContain(
          "drawer.traceId=trace_a",
        );
      });
    });

    describe("when the rows are still loading", () => {
      it("holds the known count in the title over skeleton rows", () => {
        useCapabilityDataMock.mockReturnValue({
          status: "hydrating",
          rows: [],
          loadedCount: 0,
          totalCount: 34,
          isHydrating: true,
        });
        renderHydrated();

        expect(screen.getByText("34 traces · showing 2")).toBeTruthy();
        expect(screen.queryByText("No traces matched.")).toBeNull();
      });
    });

    describe("when none of the referenced traces exist any more", () => {
      it("says so honestly and keeps the way into the Explorer", () => {
        useCapabilityDataMock.mockReturnValue({
          status: "hydrated",
          rows: [],
          loadedCount: 0,
          totalCount: 34,
          isHydrating: false,
        });
        renderHydrated();

        expect(
          screen.getByText("These traces are no longer available."),
        ).toBeTruthy();
        expect(screen.queryByText("No traces matched.")).toBeNull();
        expect(screen.getByText("View in Trace Explorer")).toBeTruthy();
      });
    });

    describe("when hydration fails outright", () => {
      it("owns the failure and keeps the deep link", () => {
        useCapabilityDataMock.mockReturnValue({
          status: "unavailable",
          rows: [],
          loadedCount: 0,
          totalCount: 34,
          isHydrating: false,
        });
        renderHydrated();

        expect(
          screen.getByText(/Couldn.t load these traces right now/),
        ).toBeTruthy();
        expect(screen.getByText("View in Trace Explorer")).toBeTruthy();
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
