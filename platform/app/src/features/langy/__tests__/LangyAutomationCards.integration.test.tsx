/**
 * @vitest-environment jsdom
 *
 * The automation card a `langwatch trigger` result draws, and the Slack
 * connection card a refused Slack save draws instead of the failure card.
 * The viewer's reads are mocked at the hook seam.
 *
 * @see specs/langy/langy-automations.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangyAutomationCard } from "../components/automations/LangyAutomationCard";
import { resolveCapability } from "../components/capabilities/capabilityRegistry";
import { LangyFailedStepCard } from "../components/LangyFailedStepCard";
import {
  type LangySend,
  LangySendProvider,
} from "../components/LangySendContext";
import type { LangySlackConnectionSummary } from "../hooks/useLangyAutomationData";

const slack = vi.fn(() => ({
  connections: [] as LangySlackConnectionSummary[] | undefined,
  canAdd: true,
  isLoading: false,
  isError: false,
}));
const now = vi.fn(() => ({ fresh: null, nextFiring: null }));
vi.mock("../hooks/useLangyAutomationData", () => ({
  useLangySlackConnections: () => slack(),
  useLangyAutomationNow: () => now(),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "acme" } }),
}));

const supportSlack: LangySlackConnectionSummary = {
  id: "slack_1",
  name: "Support Slack",
  kind: "BOT",
  scopeType: "PROJECT",
};

const alert = {
  id: "trig_1",
  name: "Support error rate",
  action: "SEND_SLACK_MESSAGE",
  active: true,
  kind: "ALERT",
  customGraphId: "graph_1",
  graphAlert: {
    seriesName: "0/metadata.error_rate/avg",
    operator: "gt",
    threshold: 5,
    timePeriod: 5,
  },
  actionParams: {
    slackIntegrationId: "slack_1",
    slackDelivery: "bot",
    slackChannelId: "support-alerts",
  },
};

function wrap(node: React.ReactNode, send: LangySend | null = null) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangySendProvider value={send}>{node}</LangySendProvider>
    </ChakraProvider>,
  );
}

function renderTrigger(verb: string, output: unknown) {
  const descriptor = resolveCapability(`langwatch.trigger.${verb}`);
  if (!descriptor) throw new Error("no descriptor");
  return wrap(
    <LangyAutomationCard
      descriptor={descriptor}
      input={{}}
      output={output}
      projectSlug="acme"
    />,
  );
}

const refusedSlackCall = {
  name: "bash",
  input: {
    command:
      'langwatch trigger create "Errors" --action SEND_SLACK_MESSAGE --slack-channel "#support-alerts"',
  },
};
const refusal = {
  title: "Couldn't create the automation",
  message: "The request was refused.",
  detail: "Choose a Slack connection.",
};

beforeEach(() => {
  slack.mockReturnValue({
    connections: [supportSlack],
    canAdd: true,
    isLoading: false,
    isError: false,
  });
  now.mockReturnValue({ fresh: null, nextFiring: null });
});

describe("the automation card", () => {
  /** @scenario "A created alert renders as an automation card" */
  it("names a created alert, its condition and state, and links to it", () => {
    renderTrigger("create", alert);
    expect(screen.getByText("New alert")).toBeTruthy();
    expect(screen.getByText("Support error rate")).toBeTruthy();
    expect(screen.getByText("avg error rate > 5 over 5 min")).toBeTruthy();
    expect(screen.getByTestId("langy-automation-state")).toHaveTextContent(
      "Active",
    );
    const link = screen.getByText("Open in Automations").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/acme/automations?drawer.open=viewAutomation&drawer.automationId=trig_1",
    );
  });

  /** @scenario "A Slack destination names its connection and channel" */
  it("names the Slack connection and channel it posts to", () => {
    renderTrigger("create", alert);
    const chips = screen.getByTestId("langy-automation-destinations");
    expect(chips).toHaveTextContent("Support Slack");
    expect(chips).toHaveTextContent("#support-alerts");
  });

  /** @scenario "An email automation lists its recipients as the destination" */
  it("lists an email automation's recipient and trace condition", () => {
    renderTrigger("create", {
      id: "trig_2",
      name: "Thumbs down",
      action: "SEND_EMAIL",
      active: true,
      filterQuery: "annotation:thumbs_down",
      actionParams: { members: ["me@example.com"] },
    });
    expect(
      screen.getByTestId("langy-automation-destinations"),
    ).toHaveTextContent("me@example.com");
    expect(
      screen.getByText("Trace filter · annotation:thumbs_down"),
    ).toBeTruthy();
  });

  /** @scenario "Pausing an automation shows it paused" */
  it("shows a paused automation as paused, from the pause's short answer", () => {
    renderTrigger("disable", {
      id: "trig_1",
      name: "Support error rate",
      active: false,
    });
    expect(screen.getByText("Paused automation")).toBeTruthy();
    expect(screen.getByTestId("langy-automation-state")).toHaveTextContent(
      "Paused",
    );
  });

  /** @scenario "A list of automations renders one row per automation with its state" */
  it("lists one row per automation with its state", () => {
    renderTrigger("list", [
      alert,
      { ...alert, id: "trig_2", name: "Night report", active: false },
    ]);
    expect(screen.getByText("2 automations · 1 active")).toBeTruthy();
    const states = screen.getAllByTestId("langy-automation-state");
    expect(states.map((s) => s.textContent)).toEqual(["Active", "Paused"]);
  });
});

describe("a Slack automation refused for want of a connection", () => {
  /** @scenario "No Slack connection yet guides me to add one" */
  it("guides the reader to add one on the Automations page", () => {
    slack.mockReturnValue({
      connections: [],
      canAdd: true,
      isLoading: false,
      isError: false,
    });
    wrap(
      <LangyFailedStepCard call={refusedSlackCall} presentation={refusal} />,
    );
    expect(
      screen.getByText("This project has no Slack connection yet"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("langy-add-slack-connection").getAttribute("href"),
    ).toBe("/acme/automations?drawer.open=slackConnection");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** @scenario "Existing Slack connections are offered to pick from" */
  it("offers the project's connections, and choosing one answers Langy", () => {
    const send = vi.fn();
    wrap(
      <LangyFailedStepCard call={refusedSlackCall} presentation={refusal} />,
      { send, isTurnInFlight: false },
    );
    const row = screen.getByTestId("langy-slack-connection-row");
    expect(row).toHaveTextContent("Support Slack");
    expect(row).toHaveTextContent("Bot · This project");
    fireEvent.click(screen.getByText("Use this connection"));
    expect(send).toHaveBeenCalledWith(
      'Use the Slack connection "Support Slack" (id slack_1) and post in #support-alerts.',
    );
  });

  /** @scenario "A refused create shows the API's reason" */
  it("shows the reason the automations API gave", () => {
    wrap(
      <LangyFailedStepCard call={refusedSlackCall} presentation={refusal} />,
    );
    expect(screen.getByTestId("langy-slack-refusal-reason")).toHaveTextContent(
      "Choose a Slack connection.",
    );
  });

  it("leaves any other failure on the failure card", () => {
    wrap(
      <LangyFailedStepCard
        call={{
          name: "bash",
          input: { command: "langwatch trigger create X --action SEND_EMAIL" },
        }}
        presentation={refusal}
      />,
    );
    expect(screen.queryByTestId("langy-slack-connection-card")).toBeNull();
    expect(screen.getByText("Couldn't create the automation")).toBeTruthy();
  });
});
