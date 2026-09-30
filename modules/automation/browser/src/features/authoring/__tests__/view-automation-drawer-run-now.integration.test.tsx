import { cleanup, screen } from "@testing-library/react";
/**
 * @vitest-environment jsdom
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import { ViewAutomationDrawer } from "../ui/sections/view-automation-drawer.tsx";
import type * as ViewDrawerFixture from "./view-drawer.fixture.ts";
import {
  GRAPH_ALERT_ROW,
  resetViewDrawerState,
  TRACE_AUTOMATION_ROW,
  viewDrawerState,
} from "./view-drawer.fixture.ts";

vi.mock("../../../behavior/automation-session.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

vi.mock("../../../ui/elements/filter-display.tsx", () => ({
  FilterDisplay: ({ filters }: { filters: string }) => (
    <div data-testid="filter-display">{filters}</div>
  ),
}));

vi.mock("../../../behavior/automation-api.ts", async () => {
  const fixture = await vi.importActual<typeof ViewDrawerFixture>("./view-drawer.fixture.ts");
  return { api: fixture.viewDrawerApi() };
});

vi.mock("../../../behavior/slack-api.ts", async () => {
  const fixture = await vi.importActual<typeof ViewDrawerFixture>("./view-drawer.fixture.ts");
  return { slackApi: fixture.viewDrawerSlackApi() };
});

const onClose = vi.fn();
const onEdit = vi.fn();

function renderDrawer() {
  return renderWithAutomationHost(
    <ViewAutomationDrawer automationId="trigger_1" onClose={onClose} onEdit={onEdit} />,
    { host: fakeAutomationHost() },
  );
}

const MINUTE_MS = 60 * 1000;
const RUN = { name: "Run the conditions now" };

describe("ViewAutomationDrawer run-now", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetViewDrawerState();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a trace automation with a search query", () => {
    describe("when the drawer renders", () => {
      it("runs no trace search until the reader asks", () => {
        viewDrawerState.trigger = TRACE_AUTOMATION_ROW;
        renderDrawer();

        expect(viewDrawerState.tracesListInputs).toEqual([]);
      });
    });

    describe("when the user runs the conditions against recent traces", () => {
      /** @scenario Run now lists currently matching traces */
      it("lists the matching traces with their input and output", async () => {
        viewDrawerState.trigger = TRACE_AUTOMATION_ROW;
        viewDrawerState.matchingTraces = {
          totalHits: 3,
          items: [
            {
              traceId: "trace_1",
              name: "checkout agent",
              timestamp: Date.now() - MINUTE_MS,
              durationMs: 1234,
              status: "error",
              input: "book me a flight",
              output: "upstream timed out",
            },
          ],
        };
        renderDrawer();

        await userEvent.click(screen.getByRole("button", RUN));

        expect(screen.getByText("3 traces matched in the last 7 days")).toBeDefined();
        expect(screen.getByText("checkout agent")).toBeDefined();
        expect(screen.getByText("trace_1")).toBeDefined();
        expect(screen.getByText(/1\.2s/)).toBeDefined();
        expect(screen.getByText(/book me a flight/)).toBeDefined();
        expect(screen.getByText(/upstream timed out/)).toBeDefined();
        expect(viewDrawerState.tracesListInputs.at(-1)).toMatchObject({
          projectId: "project-1",
          query: "status:error",
          pageSize: 5,
        });
      });

      /** @scenario A never-matched automation explains itself */
      it("explains that nothing matched and why it stays quiet", async () => {
        viewDrawerState.trigger = TRACE_AUTOMATION_ROW;
        viewDrawerState.matchingTraces = { totalHits: 0, items: [] };
        renderDrawer();

        await userEvent.click(screen.getByRole("button", RUN));

        expect(screen.getByText(/Nothing matched in the last 7 days/)).toBeDefined();
        expect(screen.getByText(/so it stays quiet until one does/)).toBeDefined();
      });
    });
  });

  describe("given an alert that watches a graph metric", () => {
    describe("when the drawer renders", () => {
      /** @scenario A graph-watching automation offers no trace run */
      it("offers no run-against-traces control", () => {
        viewDrawerState.trigger = GRAPH_ALERT_ROW;
        renderDrawer();

        expect(screen.queryByRole("button", RUN)).toBeNull();
      });
    });
  });
});
