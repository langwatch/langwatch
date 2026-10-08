/**
 * @vitest-environment jsdom
 * The result cards a settled LangWatch call draws, from the recorded payload.
 * Mocks: host, tRPC, router, hydration hook, recharts' ResponsiveContainer.
 * Spec: specs/langy/langy-capability-cards.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { toCliToolResult } from "@langwatch/langy-contract";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { cloneElement, type ReactElement } from "react";
import type * as rechartsModule from "recharts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../../model/langy-host.ts";

vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

class FakeLangyHost extends LangyHostApi {
  project(): LangyHostProject | undefined {
    return { id: "p_demo", slug: "demo", name: "demo" };
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

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../../behavior/langy-api.ts", () => ({
  api: {
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

const IDLE_HYDRATION: CapabilityData = {
  status: "idle",
  rows: [],
  loadedCount: 0,
  totalCount: null,
  isHydrating: false,
};
// What the viewer's own fetch of the result's references returned.
const hydration = vi.hoisted((): { current: CapabilityData | null } => ({ current: null }));

vi.mock("../../../../behavior/use-capability-data.ts", () => ({
  useCapabilityData: () => hydration.current ?? IDLE_HYDRATION,
}));

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof rechartsModule>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

import type { CapabilityData } from "../../../../behavior/use-capability-data.ts";
import { LangyToolActivity } from "../../langy-tool-activity.tsx";
import { LangyCapabilityRenderer } from "../langy-capability-renderer.tsx";

afterEach(() => {
  cleanup();
  hydration.current = null;
  window.matchMedia = originalMatchMedia;
});

// The setup's matchMedia stub is writable but not configurable; assign, then restore.
const originalMatchMedia = window.matchMedia;

function mockReducedMotion(matches: boolean) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes("prefers-reduced-motion") ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

/**
 * A settled call carrying the result the CLI envelope recorded for it — the
 * same stamp the worker writes into the event log, so the card the panel draws
 * is the card the boundary decided.
 */
function settledCall({
  name,
  resource,
  verb,
  payload,
}: {
  name: string;
  resource: string;
  verb: string;
  payload: unknown;
}) {
  return {
    name,
    state: "output-available",
    input: {},
    output: JSON.stringify(payload),
    result: toCliToolResult({ resource, verb, payload }),
  };
}

function inHost(node: ReactElement) {
  return (
    <DesignSystemProvider forcedTheme="light">
      <LangyHostProvider value={host}>{node}</LangyHostProvider>
    </DesignSystemProvider>
  );
}

function renderCall(call: Parameters<typeof LangyCapabilityRenderer>[0]["call"]) {
  return render(inHost(<LangyCapabilityRenderer call={call} />));
}

const SEARCH_COMMAND = "langwatch trace search --query 'refund' --format json";

const storedSearch = {
  traces: [
    { trace_id: "trace_stored_a", input: { value: "stored question a" } },
    { trace_id: "trace_stored_b", input: { value: "stored question b" } },
  ],
  pagination: { totalHits: 2 },
};

function traceSearchCall() {
  return {
    ...settledCall({
      name: "langwatch.trace.search",
      resource: "trace",
      verb: "search",
      payload: storedSearch,
    }),
    input: { command: SEARCH_COMMAND },
  };
}

describe("given Langy ran an experiment and it completed", () => {
  describe("when the panel renders the call", () => {
    /** @scenario "An evaluation run renders its result" */
    it("shows an evaluation-run card with the outcome, linking to the run", () => {
      renderCall(
        settledCall({
          name: "langwatch.experiment.run",
          resource: "experiment",
          verb: "run",
          payload: {
            runId: "run_9",
            status: "completed",
            passed: 8,
            failed: 2,
            platformUrl: "https://app.langwatch.ai/demo/experiments/exp_1?runId=run_9",
          },
        }),
      );

      expect(screen.getByText("Run experiment")).toBeTruthy();
      expect(screen.getByText("completed")).toBeTruthy();
      expect(screen.getByText("80%")).toBeTruthy();
      const link = screen.getByText(/Open in Experiments/i).closest("a");
      expect(link?.getAttribute("href")).toContain("run_9");
    });
  });
});

describe("given Langy listed a dataset and it returned records", () => {
  describe("when the panel renders the call", () => {
    /** @scenario "A dataset listing renders the records inline" */
    it("shows a dataset card summarising the records, with a way into Datasets", () => {
      renderCall(
        settledCall({
          name: "langwatch.dataset.list",
          resource: "dataset",
          verb: "list",
          payload: {
            data: [{ name: "golden-set" }, { name: "edge-cases" }],
            pagination: { total: 2 },
          },
        }),
      );

      expect(screen.getByText("golden-set")).toBeTruthy();
      expect(screen.getByText("edge-cases")).toBeTruthy();
      expect(
        screen
          .getByText(/Open in Datasets/i)
          .closest("a")
          ?.getAttribute("href"),
      ).toContain("/demo/datasets");
    });
  });
});

describe("given Langy fetched a scenario simulation", () => {
  describe("when the panel renders the call", () => {
    /** @scenario "A scenario result renders as a scenario card" */
    it("shows a scenario card with the outcome, linking to Simulations", () => {
      renderCall(
        settledCall({
          name: "langwatch.scenario.get",
          resource: "scenario",
          verb: "get",
          payload: { id: "scenario_1", name: "Refund flow", status: "passed" },
        }),
      );

      expect(screen.getByText("Refund flow")).toBeTruthy();
      expect(screen.getByText("passed")).toBeTruthy();
      expect(screen.getByText(/Open in Simulations/i).closest("a")).toBeTruthy();
    });
  });
});

describe("given Langy looked up one trace", () => {
  describe("when the panel renders the call", () => {
    /** @scenario "A single trace lookup renders a span summary" */
    it("shows a trace card summarising that trace, linking to it", () => {
      renderCall(
        settledCall({
          name: "langwatch.trace.get",
          resource: "trace",
          verb: "get",
          payload: {
            trace_id: "trace_abc123456789",
            input: "How long does a refund take?",
            output: "Refunds land within five working days.",
          },
        }),
      );

      expect(screen.getByText("Trace trace_abc1")).toBeTruthy();
      expect(screen.getByText("How long does a refund take?")).toBeTruthy();
      expect(screen.getByText("Refunds land within five working days.")).toBeTruthy();
      const link = screen.getByText(/Open in Traces/i).closest("a");
      expect(link?.getAttribute("href")).toContain("trace_abc123456789");
    });
  });
});

describe("given Langy searched traces and the viewer's fetch returned rows", () => {
  describe("when the panel renders the card", () => {
    /** @scenario "A card shows current data, fetched as the viewer" */
    it("draws the rows fetched fresh, not the ones the turn recorded", () => {
      hydration.current = {
        status: "hydrated",
        rows: [{ id: "trace_visible", primary: "fresh question" }],
        loadedCount: 1,
        totalCount: 1,
        isHydrating: false,
      };
      renderCall(traceSearchCall());

      expect(screen.getByText("fresh question")).toBeTruthy();
      expect(screen.queryByText("stored question a")).toBeNull();
      expect(screen.queryByText("stored question b")).toBeNull();
    });

    /** @scenario "A card shows current data, fetched as the viewer" */
    it("draws a teammate's card from their own fetch, so each sees only their rows", () => {
      hydration.current = {
        status: "hydrated",
        rows: [
          { id: "trace_visible", primary: "fresh question" },
          { id: "trace_teammate", primary: "teammate-only question" },
        ],
        loadedCount: 2,
        totalCount: 2,
        isHydrating: false,
      };
      renderCall(traceSearchCall());

      expect(screen.getByText("fresh question")).toBeTruthy();
      expect(screen.getByText("teammate-only question")).toBeTruthy();
      expect(screen.queryByText("stored question a")).toBeNull();
    });
  });
});

/** The CSS rules that style the first placeholder line, as text. */
function placeholderStyle(container: HTMLElement): string {
  const line = container.querySelector('[aria-hidden="true"] > div > div');
  const classes = [...(line?.classList ?? [])];
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .map((rule) => rule.cssText)
    .filter((text) => classes.some((name) => text.includes(`.${name}`)))
    .join("\n");
}

describe("given a results card is still fetching its rows", () => {
  const fetching: CapabilityData = {
    status: "hydrating",
    rows: [],
    loadedCount: 0,
    totalCount: 34,
    isHydrating: true,
  };

  describe("when the card renders", () => {
    /** @scenario "A card holds its shape while its rows load" */
    it("shows the honest count and placeholder rows in place of the results", () => {
      hydration.current = fetching;
      const { container } = renderCall(traceSearchCall());

      expect(screen.getByText(/^34 traces/)).toBeTruthy();
      expect(screen.queryByText("stored question a")).toBeNull();
      expect(container.querySelectorAll('[aria-hidden="true"] > div').length).toBeGreaterThan(0);
    });
  });

  describe("when the reader prefers reduced motion", () => {
    /** @scenario "A card holds its shape while its rows load" */
    it("keeps the placeholders still", () => {
      hydration.current = fetching;
      mockReducedMotion(false);
      const moving = placeholderStyle(renderCall(traceSearchCall()).container);
      cleanup();
      mockReducedMotion(true);
      const still = placeholderStyle(renderCall(traceSearchCall()).container);

      expect(moving).toMatch(/animation:\s*(?!none)\S/);
      expect(still).toMatch(/animation:\s*none/);
    });
  });
});

describe("given Langy has started a trace search that has not returned", () => {
  function searchMessage(part: Record<string, unknown>): UIMessage {
    const parts: UIMessage["parts"] = [];
    Object.assign(parts, [part]);
    return { id: "assistant-1", role: "assistant", parts };
  }
  const started = {
    type: "tool-bash",
    toolCallId: "call-1",
    state: "input-available",
    input: { command: SEARCH_COMMAND },
  };

  describe("when the panel renders the turn", () => {
    /** @scenario "A capability tool still in flight reads as an activity line" */
    it("shows a pending activity line, and the traces card only once it returns", () => {
      const { rerender } = render(inHost(<LangyToolActivity message={searchMessage(started)} />));

      expect(screen.getByText(/Searching traces/)).toBeTruthy();
      expect(screen.queryByText("2 traces")).toBeNull();

      const settled = traceSearchCall();
      rerender(
        inHost(
          <LangyToolActivity
            message={searchMessage({
              ...started,
              state: "output-available",
              output: settled.output,
              result: settled.result,
            })}
          />,
        ),
      );

      expect(screen.getByText("2 traces")).toBeTruthy();
      expect(screen.queryByText(/Searching traces…/)).toBeNull();
    });
  });
});
