/**
 * @vitest-environment jsdom
 * The automation card a `langwatch trigger` result draws, and the Slack connection card a refused
 * Slack save draws instead of the failure card. The viewer's reads are mocked at the hook seam.
 * @see specs/langy/langy-automations.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { SlackConnection } from "@langwatch/slack-contract";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../../model/langy-host.ts";
import type { useLangySlackConnections } from "../../../../behavior/use-langy-automation-data.ts";
import { resolveCapability } from "../../../../model/capabilities/capability-registry.ts";
import { LangyFailedStepCard } from "../../langy-failed-step-card.tsx";
import { type LangySend, LangySendProvider } from "../../langy-send-context.tsx";
import { LangyAutomationCard } from "../langy-automation-card.tsx";

type SlackRead = ReturnType<typeof useLangySlackConnections>;

const slack = vi.fn<() => SlackRead>();
vi.mock("../../../../behavior/use-langy-automation-data.ts", () => ({
  useLangySlackConnections: () => slack(),
  useLangyAutomationNow: () => ({ fresh: undefined, nextFiring: undefined }),
}));

class FakeLangyHost extends LangyHostApi {
  project(): LangyHostProject | undefined {
    return { id: "p1", slug: "acme", name: "acme" };
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
    return { id: "user-1" };
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

const supportSlack: SlackConnection = {
  id: "slack_1",
  name: "Support Slack",
  kind: "BOT",
  scopeType: "PROJECT",
  scopeId: "p1",
  scopeName: "acme",
  secretHint: "abcd",
  slackTeamId: null,
  slackTeamName: null,
  dependentAutomations: 0,
  canManage: true,
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

function wrap({ node, send = null }: { node: ReactNode; send?: LangySend | null }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyHostProvider value={host}>
        <LangySendProvider value={send}>{node}</LangySendProvider>
      </LangyHostProvider>
    </ChakraProvider>,
  );
}

function renderTrigger({ verb, output }: { verb: string; output: unknown }) {
  const descriptor = resolveCapability(`langwatch.trigger.${verb}`);
  if (!descriptor) throw new Error("no descriptor");
  return wrap({
    node: (
      <LangyAutomationCard descriptor={descriptor} input={{}} output={output} projectSlug="acme" />
    ),
  });
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
});

describe("the automation card", () => {
  /** @scenario "A created alert renders as an automation card" */
  it("names a created alert, its condition and state, and links to it", () => {
    renderTrigger({ verb: "create", output: alert });
    expect(screen.getByText("New alert")).toBeTruthy();
    expect(screen.getByText("Support error rate")).toBeTruthy();
    expect(screen.getByText("avg error rate > 5 over 5 min")).toBeTruthy();
    expect(screen.getByTestId("langy-automation-state").textContent).toContain("Active");
    const link = screen.getByText("Open in Automations").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/acme/automations?drawer.open=viewAutomation&drawer.automationId=trig_1",
    );
  });

  /** @scenario "A Slack destination names its connection and channel" */
  it("names the Slack connection and channel it posts to", () => {
    renderTrigger({ verb: "create", output: alert });
    const destinations = screen.getByTestId("langy-automation-destinations");
    expect(destinations.textContent).toContain("Support Slack");
    expect(destinations.textContent).toContain("#support-alerts");
  });

  /** @scenario "An email automation lists its recipients as the destination" */
  it("lists an email automation's recipient and trace condition", () => {
    renderTrigger({
      verb: "create",
      output: {
        id: "trig_2",
        name: "Thumbs down",
        action: "SEND_EMAIL",
        active: true,
        filterQuery: "annotation:thumbs_down",
        actionParams: { members: ["me@example.com"] },
      },
    });
    expect(screen.getByTestId("langy-automation-destinations").textContent).toContain(
      "me@example.com",
    );
    expect(screen.getByText("Trace filter · annotation:thumbs_down")).toBeTruthy();
  });

  /** @scenario "Pausing an automation shows it paused" */
  it("shows a paused automation as paused, from the pause's short answer", () => {
    renderTrigger({
      verb: "disable",
      output: { id: "trig_1", name: "Support error rate", active: false },
    });
    expect(screen.getByText("Paused automation")).toBeTruthy();
    expect(screen.getByTestId("langy-automation-state").textContent).toContain("Paused");
  });

  /** @scenario "A list of automations renders one row per automation with its state" */
  it("lists one row per automation with its state", () => {
    renderTrigger({
      verb: "list",
      output: [alert, { ...alert, id: "trig_2", name: "Night report", active: false }],
    });
    expect(screen.getByText("2 automations · 1 active")).toBeTruthy();
    const states = screen.getAllByTestId("langy-automation-state");
    expect(states.map((state) => state.textContent)).toEqual(["Active", "Paused"]);
  });
});

describe("a Slack automation refused for want of a connection", () => {
  /** @scenario "No Slack connection yet guides me to add one" */
  it("guides the reader to slack's connection drawer on the Automations page", () => {
    slack.mockReturnValue({ connections: [], canAdd: true, isLoading: false, isError: false });
    wrap({ node: <LangyFailedStepCard call={refusedSlackCall} presentation={refusal} /> });
    expect(screen.getByText("This project has no Slack connection yet")).toBeTruthy();
    expect(screen.getByTestId("langy-add-slack-connection").getAttribute("href")).toBe(
      "/acme/automations?drawer.open=slackConnection",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** @scenario "Existing Slack connections are offered to pick from" */
  it("offers the project's connections, and choosing one answers Langy", () => {
    const send = vi.fn();
    wrap({
      node: <LangyFailedStepCard call={refusedSlackCall} presentation={refusal} />,
      send: { send, isTurnInFlight: false },
    });
    const row = screen.getByTestId("langy-slack-connection-row");
    expect(row.textContent).toContain("Support Slack");
    expect(row.textContent).toContain("Bot · This project");
    fireEvent.click(screen.getByText("Use this connection"));
    expect(send).toHaveBeenCalledWith(
      'Use the Slack connection "Support Slack" (id slack_1) and post in #support-alerts.',
    );
  });

  /** @scenario "A refused create shows the API's reason" */
  it("shows the reason the automations API gave", () => {
    wrap({ node: <LangyFailedStepCard call={refusedSlackCall} presentation={refusal} /> });
    expect(screen.getByTestId("langy-slack-refusal-reason").textContent).toContain(
      "Choose a Slack connection.",
    );
  });

  it("leaves any other failure on the failure card", () => {
    const call = {
      name: "bash",
      input: { command: "langwatch trigger create X --action SEND_EMAIL" },
    };
    wrap({ node: <LangyFailedStepCard call={call} presentation={refusal} /> });
    expect(screen.queryByTestId("langy-slack-connection-card")).toBeNull();
    expect(screen.getByText("Couldn't create the automation")).toBeTruthy();
  });
});
