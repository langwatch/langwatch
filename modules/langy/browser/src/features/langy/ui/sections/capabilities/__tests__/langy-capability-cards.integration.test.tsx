/**
 * @vitest-environment jsdom
 * The result cards a settled LangWatch call draws, from the recorded payload.
 * Mocks: host, tRPC, router, hydration hook, recharts' ResponsiveContainer.
 * Spec: specs/langy/langy-capability-cards.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { toCliToolResult } from "@langwatch/langy-contract";
import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("../../../../behavior/use-capability-data.ts", () => ({
  useCapabilityData: () => ({
    status: "idle",
    rows: [],
    loadedCount: 0,
    totalCount: null,
    isHydrating: false,
  }),
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

import { LangyCapabilityRenderer } from "../langy-capability-renderer.tsx";

afterEach(cleanup);

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

function renderCall(call: Parameters<typeof LangyCapabilityRenderer>[0]["call"]) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyHostProvider value={host}>
        <LangyCapabilityRenderer call={call} />
      </LangyHostProvider>
    </DesignSystemProvider>,
  );
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
