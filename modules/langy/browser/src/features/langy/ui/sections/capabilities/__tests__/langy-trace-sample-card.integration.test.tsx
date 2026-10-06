/**
 * @vitest-environment jsdom
 * @integration
 * Spec: specs/langy/langy-trace-explorer-link.feature.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../../model/langy-host.ts";

vi.mock("../../../../behavior/use-capability-data.ts", () => ({
  useCapabilityData: () => ({
    status: "idle",
    rows: [],
    loadedCount: 0,
    totalCount: null,
    isHydrating: false,
  }),
}));

import { resolveCapability } from "../../../../../../model/langy-capability-registry.ts";
import { LangyTraceSampleCard } from "../langy-trace-sample-card.tsx";

const descriptor = resolveCapability("langwatch.trace.search")!;

/**
 * A minimal host: the deep-link chip and the row links both resolve through
 * `useRouter`, which throws outside a `LangyHostProvider`.
 */
class FakeLangyHost extends LangyHostApi {
  project(): LangyHostProject | undefined {
    return { id: "project-acme", slug: "acme", name: "acme" };
  }
  organization(): LangyHostOrganization | undefined {
    return { id: "org-1" };
  }
  team(): LangyHostTeam | undefined {
    return { id: "team-1" };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  featureFlag() {
    return true;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}
const host = new FakeLangyHost();

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

function renderCard({ totalHits, count }: { totalHits: number; count: number }) {
  const traces = Array.from({ length: count }, (_, i) => trace(`trace_${i}`, 1750000000000 + i));
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyHostProvider value={host}>
        <LangyTraceSampleCard
          descriptor={descriptor}
          input={{ command }}
          output={{ traces, pagination: { totalHits } }}
          projectSlug="acme"
        />
      </LangyHostProvider>
    </DesignSystemProvider>,
  );
}

// What the recorder's reduction left of a real 13-match search: every row cut
// down to its first keys in alphabetical order, "trace_id" not among them.
const reducedRow = {
  "…": "5 more keys truncated",
  error: null,
  evaluations: [],
  input: { value: "How long does a refund take to reach my card?" },
  metadata: { labels: ["refund"] },
  metrics: { total_cost: 0.002 },
};

function renderReduced() {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyHostProvider value={host}>
        <LangyTraceSampleCard
          descriptor={descriptor}
          input={{ command }}
          output={{
            traces: [reducedRow, reducedRow, "… 8 more items truncated, 13 total"],
            pagination: { totalHits: 13 },
          }}
          projectSlug="acme"
        />
      </LangyHostProvider>
    </DesignSystemProvider>,
  );
}

describe("LangyTraceSampleCard", () => {
  describe("given a CLI trace search that returned matching traces", () => {
    describe("when the card renders", () => {
      /** @scenario "A CLI trace search renders the traces card" */
      it("lists the matched traces, each row linking to its own trace", () => {
        renderCard({ totalHits: 2, count: 2 });

        expect(screen.getByText("2 traces")).toBeTruthy();
        expect(screen.getByText("question trace_0")).toBeTruthy();
        expect(screen.getByText("question trace_1")).toBeTruthy();
        const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href") ?? "");
        expect(hrefs.some((href) => href.includes("trace_0"))).toBe(true);
        expect(hrefs.some((href) => href.includes("trace_1"))).toBe(true);
      });
    });
  });

  describe("given a CLI trace search that returned none", () => {
    describe("when the card renders", () => {
      /** @scenario "A CLI trace search that matched nothing renders an empty traces card" */
      /** @scenario "A genuinely empty result still reads as a real answer" */
      it("says no traces matched", () => {
        renderCard({ totalHits: 0, count: 0 });

        expect(screen.getByText("No traces matched.")).toBeTruthy();
      });
    });
  });

  describe("given recorded rows that lost their trace id", () => {
    describe("when the card renders", () => {
      /** @scenario "Rows the card cannot identify render as unreadable, never as an empty result" */
      /** @scenario "Unreadable tool output renders as unreadable, never as an empty result" */
      it("says it could not read the result instead of claiming nothing matched", () => {
        renderReduced();

        expect(screen.getByText(/Couldn.t read this result/)).toBeTruthy();
        expect(screen.queryByText("No traces matched.")).toBeNull();
        expect(screen.queryByText(/showing 0/)).toBeNull();
      });

      /** @scenario "Rows the card cannot identify render as unreadable, never as an empty result" */
      /** @scenario "Unreadable tool output renders as unreadable, never as an empty result" */
      it("still offers the way through to the Trace Explorer", () => {
        renderReduced();

        expect(screen.getByText("View in Trace Explorer")).toBeTruthy();
      });
    });
  });

  describe("given a search that matched far more traces than it returned", () => {
    describe("when the card renders", () => {
      /** @scenario "The sample never pretends to be the whole result" */
      /** @scenario "A result too large for the chat still renders correctly" */
      it("says how many were found and how many it is showing", () => {
        renderCard({ totalHits: 34, count: 25 });

        expect(screen.getByText("34 traces · showing 3")).toBeTruthy();
        expect(screen.getByText("question trace_0")).toBeTruthy();
        expect(screen.getByText("View in Trace Explorer")).toBeTruthy();
        expect(screen.getByText("31 more in the Trace Explorer")).toBeTruthy();
      });
    });
  });
});
