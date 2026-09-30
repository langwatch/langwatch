import { cleanup, screen } from "@testing-library/react";
/**
 * @vitest-environment jsdom
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import {
  RegisteredViewAutomationDrawer,
  ViewAutomationDrawer,
} from "../ui/sections/view-automation-drawer.tsx";
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

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const SLACK_WEBHOOK = { slackWebhook: "https://hooks.slack.com/services/abc" };

const graphAlert = {
  id: "trigger_1",
  name: "p95 latency alert",
  active: true,
  triggerKind: "ALERT",
  action: "SEND_SLACK_MESSAGE",
  customGraphId: "graph_1",
  filters: "{}",
  filterQuery: null,
  actionParams: {
    ...SLACK_WEBHOOK,
    seriesName: "0/latency/p95",
    operator: "gt",
    threshold: 250,
    timePeriod: 60,
  },
};

const slackTrigger = (actionParams: Record<string, unknown>) => ({
  id: "trigger_1",
  name: "Slack automation",
  active: true,
  triggerKind: "AUTOMATION",
  action: "SEND_SLACK_MESSAGE",
  customGraphId: null,
  filters: "{}",
  filterQuery: null,
  actionParams,
});

const webhookTrigger = (actionParams: Record<string, unknown>) => ({
  id: "trigger_1",
  name: "Pager webhook",
  active: true,
  triggerKind: "AUTOMATION",
  action: "SEND_WEBHOOK",
  customGraphId: null,
  filters: "{}",
  filterQuery: null,
  actionParams,
});

describe("ViewAutomationDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetViewDrawerState();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a graph alert with fire history", () => {
    beforeEach(() => {
      viewDrawerState.trigger = graphAlert;
      viewDrawerState.fires = [
        { id: "sent_open", triggerId: "trigger_1", createdAt: ago(2 * HOUR_MS), resolvedAt: null },
        {
          id: "sent_resolved",
          triggerId: "trigger_1",
          createdAt: ago(5 * HOUR_MS),
          resolvedAt: ago(5 * HOUR_MS - 15 * MINUTE_MS),
        },
      ];
    });

    describe("when the drawer renders", () => {
      it("shows the automation identity and what it watches", () => {
        renderDrawer();

        expect(screen.getByText("p95 latency alert")).toBeDefined();
        // One noun for both subjects, so the badge says what it watches (ADR-093 §1).
        expect(screen.getByText("Watches a graph")).toBeDefined();
        expect(screen.queryByText("Alert")).toBeNull();
      });

      it("lists recent fires with resolution durations", () => {
        renderDrawer();

        expect(screen.getByText(/about 5 hours ago · lasted 15 minutes/)).toBeDefined();
      });

      it("marks the open incident as still firing", () => {
        renderDrawer();

        expect(screen.getByText("Firing")).toBeDefined();
        expect(screen.getByText("still firing")).toBeDefined();
      });
    });

    describe("when the user clicks Edit", () => {
      it("hands the same automation over to the editor", async () => {
        renderDrawer();

        await userEvent.click(screen.getByRole("button", { name: "Edit" }));

        expect(onEdit).toHaveBeenCalledWith("trigger_1");
      });
    });
  });

  describe("given a saved webhook automation", () => {
    it("shows the method, safe hostname, and empty delivery state", () => {
      viewDrawerState.trigger = webhookTrigger({
        url: "https://events.example.test/private/path?token=hidden",
        method: "PATCH",
        headers: { Authorization: "__kept__" },
      });
      renderDrawer();

      expect(screen.getByText("PATCH events.example.test")).toBeDefined();
      expect(screen.getByText("No delivery attempts recorded yet.")).toBeDefined();
      expect(screen.queryByText(/token=hidden/)).toBeNull();
    });
  });

  describe("given a webhook automation with a failed delivery attempt", () => {
    beforeEach(() => {
      viewDrawerState.trigger = webhookTrigger({
        url: "https://events.example.test/hook",
        method: "POST",
        headers: {},
      });
      viewDrawerState.webhookDeliveries = [
        {
          id: "delivery_1",
          triggerId: "trigger_1",
          dispatchId: "dispatch_1",
          responseStatus: 500,
          latencyMs: 120,
          error: null,
          response: {
            body: "<script>alert('xss')</script>",
            headers: { "X-Debug": "<img src=x onerror=alert(1)>" },
          },
          outcome: "terminal",
          firedAt: ago(HOUR_MS),
        },
      ];
    });

    describe("when the user expands the attempt", () => {
      /** @scenario "The recent deliveries list shows what the endpoint answered" */
      it("renders the response body and headers as literal text, not markup", async () => {
        renderDrawer();

        await userEvent.click(screen.getByRole("button", { name: /HTTP 500/ }));

        expect(screen.getByText("<script>alert('xss')</script>")).toBeDefined();
        expect(document.querySelector("script")).toBeNull();
        expect(screen.getByText("X-Debug: <img src=x onerror=alert(1)>")).toBeDefined();
        expect(document.querySelector("img")).toBeNull();
      });
    });
  });

  describe("given a graph alert whose incident ran for over an hour", () => {
    beforeEach(() => {
      viewDrawerState.trigger = graphAlert;
    });

    describe("when the incident resolved 1h 30m after firing", () => {
      it("formats the resolution duration in hours and minutes", () => {
        viewDrawerState.fires = [
          {
            id: "sent_long",
            triggerId: "trigger_1",
            createdAt: ago(3 * HOUR_MS),
            resolvedAt: ago(3 * HOUR_MS - HOUR_MS - 30 * MINUTE_MS),
          },
        ];
        renderDrawer();

        expect(screen.getByText(/lasted 1 hour 30 minutes/)).toBeDefined();
      });
    });

    describe("when the incident resolved on an exact hour boundary", () => {
      it("omits the trailing minutes for a whole-hour duration", () => {
        viewDrawerState.fires = [
          {
            id: "sent_exact",
            triggerId: "trigger_1",
            createdAt: ago(4 * HOUR_MS),
            resolvedAt: ago(2 * HOUR_MS),
          },
        ];
        renderDrawer();

        expect(screen.getByText(/lasted 2 hours$/)).toBeDefined();
      });
    });
  });

  describe("given a bot-delivery Slack automation with a channel", () => {
    /** @scenario The automation view names its Slack destination */
    it("names the connection and shows the destination channel", () => {
      viewDrawerState.trigger = slackTrigger({
        slackDelivery: "bot",
        slackIntegrationId: "conn-bot",
        slackChannelId: "C0123456",
        slackBotTokenSet: true,
      });
      renderDrawer();

      expect(screen.getByText("Alerts bot · channel C0123456")).toBeDefined();
    });
  });

  describe("given a bot-delivery Slack automation with no channel chosen yet", () => {
    it("names the delivery method without inventing a channel", () => {
      viewDrawerState.trigger = slackTrigger({ slackDelivery: "bot", slackBotTokenSet: true });
      renderDrawer();

      expect(screen.getByText("Slack app")).toBeDefined();
      expect(screen.queryByText(/channel/)).toBeNull();
    });
  });

  describe("given a legacy Slack row saved before delivery method existed", () => {
    it("falls back to webhook delivery and shows the masked URL on hover", async () => {
      // No `slackDelivery` key at all: the shape every pre-bot row has.
      viewDrawerState.trigger = slackTrigger({
        slackWebhook: "https://hooks.slack.com/services/legacy",
      });
      renderDrawer();

      expect(screen.getByText("Slack webhook")).toBeDefined();
      expect(screen.queryByText("Slack app")).toBeNull();
      await userEvent.hover(screen.getByText("Slack webhook"));
      expect(
        await screen.findByText("https://hooks.slack.com/services/legacy", undefined, {
          timeout: 3000,
        }),
      ).toBeDefined();
    });
  });

  describe("given a Slack webhook row read through a redacting boundary", () => {
    it("shows the masked label without rendering the placeholder as a URL", async () => {
      viewDrawerState.trigger = slackTrigger({
        slackDelivery: "webhook",
        slackWebhook: "[redacted]",
      });
      renderDrawer();

      expect(screen.getByText("Slack webhook")).toBeDefined();
      await userEvent.hover(screen.getByText("Slack webhook"));
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(screen.queryByText("[redacted]")).toBeNull();
    });
  });

  describe("given a link to an automation that does not exist", () => {
    beforeEach(() => {
      viewDrawerState.trigger = null;
    });

    describe("when the drawer renders", () => {
      /** @scenario "A link to an automation that does not exist says so" */
      it("says the automation no longer exists and offers no Edit", () => {
        renderDrawer();

        expect(screen.getByTestId("automation-not-found")).toHaveTextContent(
          "This automation no longer exists",
        );
        expect(screen.queryByText("Destination")).toBeNull();
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
      });
    });
  });

  describe("given a trace automation that never fired", () => {
    beforeEach(() => {
      viewDrawerState.trigger = {
        ...slackTrigger(SLACK_WEBHOOK),
        name: "Slow traces to Slack",
        filters: JSON.stringify({ "spans.model": ["gpt-5-mini"] }),
      };
    });

    describe("when the drawer renders", () => {
      it("shows what it watches and an empty history state", () => {
        renderDrawer();

        expect(screen.getByText("Watches a trace filter")).toBeDefined();
        expect(screen.getByText(/This automation has not fired yet\./)).toBeDefined();
      });
    });
  });

  describe("given the viewer opened at its registered address", () => {
    beforeEach(() => {
      viewDrawerState.trigger = graphAlert;
    });

    describe("when the reader presses Edit", () => {
      /** @scenario "The automation viewer hands over to the editor at its registered address" */
      it("opens the automation drawer on the same automation", async () => {
        const host = fakeAutomationHost();
        renderWithAutomationHost(<RegisteredViewAutomationDrawer automationId="trigger_1" />, {
          host,
        });

        await userEvent.click(screen.getByRole("button", { name: "Edit" }));

        expect(host.recording.drawerOpens).toEqual([
          { drawer: "automation", params: { automationId: "trigger_1" } },
        ]);
      });
    });
  });
});
