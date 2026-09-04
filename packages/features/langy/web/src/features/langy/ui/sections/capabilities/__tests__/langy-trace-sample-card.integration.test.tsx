/**
 * @vitest-environment jsdom
 * @integration
 *
 * The trace-sample card's honesty rule: it shows a SAMPLE of matched traces
 * and says so, rather than letting the sample pass for the whole result.
 *
 * Spec: specs/langy/langy-trace-explorer-link.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LangyHostPort,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../../model/langy-host";

vi.mock("../../../../behavior/use-capability-data", () => ({
  useCapabilityData: () => ({
    status: "idle",
    rows: [],
    loadedCount: 0,
    totalCount: null,
    isHydrating: false,
  }),
}));

import { resolveCapability } from "../../../../../../model/langy-capability-registry";
import { LangyTraceSampleCard } from "../langy-trace-sample-card";

const descriptor = resolveCapability("langwatch.trace.search")!;

/**
 * A minimal host: the deep-link chip and the row links both resolve through
 * `useRouter`, which throws outside a `LangyHostProvider`.
 */
class FakeLangyHost extends LangyHostPort {
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
    <ChakraProvider value={defaultSystem}>
      <LangyHostProvider value={host}>
        <LangyTraceSampleCard
          descriptor={descriptor}
          input={{ command }}
          output={{ traces, pagination: { totalHits } }}
          projectSlug="acme"
        />
      </LangyHostProvider>
    </ChakraProvider>,
  );
}

describe("LangyTraceSampleCard", () => {
  describe("given a search that matched far more traces than it returned", () => {
    describe("when the card renders", () => {
      /** @scenario "The sample never pretends to be the whole result" */
      it("says how many were found and how many it is showing", () => {
        renderCard({ totalHits: 34, count: 25 });

        expect(screen.getByText("34 traces · showing 3")).toBeTruthy();
        expect(screen.getByText("31 more in the Trace Explorer")).toBeTruthy();
      });
    });
  });
});
