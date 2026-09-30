/**
 * @vitest-environment jsdom
 */
import type * as SlackKit from "@langwatch/slack-browser-kit";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import { ViewAutomationDrawer } from "../ui/sections/view-automation-drawer.tsx";
import type * as ViewDrawerFixture from "./view-drawer.fixture.ts";
import { resetViewDrawerState, viewDrawerState } from "./view-drawer.fixture.ts";

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

vi.mock("@langwatch/slack-browser-kit", async (importOriginal) => {
  const fixture = await vi.importActual<typeof ViewDrawerFixture>("./view-drawer.fixture.ts");
  return { ...(await importOriginal<typeof SlackKit>()), slackApi: fixture.viewDrawerSlackApi() };
});

const onClose = vi.fn();
const onEdit = vi.fn();

function renderDrawer() {
  return renderWithAutomationHost(
    <ViewAutomationDrawer automationId="trigger_1" onClose={onClose} onEdit={onEdit} />,
    { host: fakeAutomationHost() },
  );
}

const baseTrigger = {
  id: "trigger_1",
  name: "Slow traces to Slack",
  active: true,
  triggerKind: "AUTOMATION",
  action: "SEND_SLACK_MESSAGE",
  customGraphId: null,
  actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
};

describe("ViewAutomationDrawer conditions section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetViewDrawerState();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a query-subject automation", () => {
    beforeEach(() => {
      // The authoring path stores the query on `filterQuery` and leaves `filters` empty.
      viewDrawerState.trigger = {
        ...baseTrigger,
        filterQuery: "status:error model:gpt-5-mini",
        filters: "{}",
      };
    });

    describe("when the drawer renders", () => {
      it("shows the search query as the conditions", () => {
        renderDrawer();

        expect(screen.getByText("status:error model:gpt-5-mini")).toBeDefined();
        expect(screen.queryByTestId("filter-display")).toBeNull();
        expect(screen.queryByText("No conditions")).toBeNull();
      });
    });
  });

  describe("given a legacy automation with structured filters", () => {
    const filters = JSON.stringify({ "spans.model": ["gpt-5-mini"] });

    beforeEach(() => {
      viewDrawerState.trigger = { ...baseTrigger, filterQuery: null, filters };
    });

    describe("when the drawer renders", () => {
      it("shows the structured filters via FilterDisplay", () => {
        renderDrawer();

        expect(screen.getByTestId("filter-display").textContent).toBe(filters);
        expect(screen.queryByText("No conditions")).toBeNull();
      });
    });
  });

  describe("given an automation with canonical object filters", () => {
    const filters = { "spans.model": ["gpt-5-mini"] };

    it("shows every condition through the existing filter display", () => {
      viewDrawerState.trigger = { ...baseTrigger, filterQuery: null, filters };
      renderDrawer();

      expect(screen.getByTestId("filter-display").textContent).toBe(JSON.stringify(filters));
      expect(screen.queryByText("No conditions")).toBeNull();
    });
  });

  describe("given an automation narrowed only by a monitor check", () => {
    beforeEach(() => {
      // Monitor checks are stored as keys inside `filters`, as the table counts them.
      viewDrawerState.trigger = {
        ...baseTrigger,
        filterQuery: null,
        filters: JSON.stringify({ "evaluations.passed": { check_abc: ["false"] } }),
      };
    });

    describe("when the drawer renders", () => {
      it("does not claim it matches every trace", () => {
        renderDrawer();

        expect(screen.queryByTestId("matches-every-trace")).toBeNull();
        expect(screen.getByTestId("filter-display")).toBeInTheDocument();
      });
    });
  });

  describe("given an automation with no query and empty filters", () => {
    beforeEach(() => {
      viewDrawerState.trigger = { ...baseTrigger, filterQuery: null, filters: "{}" };
    });

    describe("when the drawer renders", () => {
      /** @scenario "An automation with no condition is flagged as matching every trace" */
      it("warns that it matches every trace", () => {
        renderDrawer();

        expect(screen.getByTestId("matches-every-trace")).toHaveTextContent("Matches every trace");
        expect(screen.queryByTestId("filter-display")).toBeNull();
      });

      /** @scenario "An automation with no condition is flagged as matching every trace" */
      it("does not claim in its history that it only acts on matching traces", () => {
        renderDrawer();

        expect(
          screen.getByText(/It has no condition, so it will act on every trace/),
        ).toBeInTheDocument();
        expect(screen.queryByText(/only acts on traces that match/)).toBeNull();
      });
    });
  });
});
