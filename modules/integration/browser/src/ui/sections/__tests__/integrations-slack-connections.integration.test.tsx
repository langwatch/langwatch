/**
 * @vitest-environment jsdom
 * The Integrations screen's Slack card lists every connection the project can use and opens
 * slack's one connection drawer to add or edit them.
 * Spec: specs/automations/slack-connections.feature.
 */

import "@testing-library/jest-dom/vitest";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlackCard } from "../slack-card.tsx";

const state = vi.hoisted(() => ({
  connections: [] as Record<string, unknown>[],
  canManageProject: true,
  canManageOrganization: false,
  openDrawer: vi.fn(),
  listInput: vi.fn(),
}));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: state.openDrawer }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme Corp" },
    project: { id: "project-1", name: "Checkout", slug: "checkout" },
  }),
}));

vi.mock("../../../behavior/slack-api.ts", () => ({
  slackApi: {
    slackIntegration: {
      list: {
        useQuery: (input: unknown) => {
          state.listInput(input);
          return {
            data: {
              connections: state.connections,
              canManageProject: state.canManageProject,
              canManageOrganization: state.canManageOrganization,
            },
            error: null,
          };
        },
      },
    },
  },
}));

function renderCard() {
  return renderWithDesignSystem(<SlackCard />);
}

const connection = (overrides: Record<string, unknown>) => ({
  id: "conn-1",
  name: "Alerts bot",
  kind: "BOT",
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  scopeName: "Acme Corp",
  secretHint: "abcd",
  slackTeamId: "T1",
  slackTeamName: "Acme HQ",
  dependentAutomations: 3,
  canManage: false,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  state.connections = [];
  state.canManageProject = true;
  state.canManageOrganization = false;
  state.openDrawer.mockReset();
  state.listInput.mockReset();
});

afterEach(() => cleanup());

describe("given the project can use an organization and a project connection", () => {
  beforeEach(() => {
    state.connections = [
      connection({}),
      connection({
        id: "conn-2",
        name: "Ops webhook",
        kind: "INCOMING_WEBHOOK",
        scopeType: "PROJECT",
        scopeId: "project-1",
        scopeName: "Checkout",
        secretHint: "wxyz",
        slackTeamId: null,
        slackTeamName: null,
        dependentAutomations: 1,
        canManage: true,
      }),
    ];
  });

  /** @scenario "Settings lists connections and opens the drawer" */
  it("lists each with its kind, whose it is, workspace or hint, and its claim count", () => {
    renderCard();

    expect(state.listInput).toHaveBeenCalledWith({ projectId: "project-1" });

    const bot = screen.getByRole("button", { name: "Edit Alerts bot" });
    expect(within(bot).getByText("Bot")).toBeInTheDocument();
    expect(within(bot).getByText("Organization")).toBeInTheDocument();
    expect(within(bot).getByText("Acme HQ")).toBeInTheDocument();
    expect(within(bot).getByText("Used by 3 automations")).toBeInTheDocument();

    const webhook = screen.getByRole("button", { name: "Edit Ops webhook" });
    expect(within(webhook).getByText("Webhook")).toBeInTheDocument();
    expect(within(webhook).getByText("This project")).toBeInTheDocument();
    expect(within(webhook).getByText("••••wxyz")).toBeInTheDocument();
    expect(within(webhook).getByText("Used by 1 automation")).toBeInTheDocument();
  });

  /** @scenario "Settings lists connections and opens the drawer" */
  it("opens the connection drawer by name from a row and from Add", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Edit Ops webhook" }));
    await user.click(screen.getByRole("button", { name: /add slack connection/i }));

    expect(state.openDrawer).toHaveBeenNthCalledWith(1, "slackConnection", {
      connectionId: "conn-2",
    });
    expect(state.openDrawer).toHaveBeenNthCalledWith(2, "slackConnection", {});
  });
});

describe("given the project has no Slack connection", () => {
  it("says so", () => {
    renderCard();

    expect(screen.getByText("No Slack connections yet.")).toBeInTheDocument();
  });
});

describe("given the reader can manage neither the project nor the organization", () => {
  it("offers no way to add one", () => {
    state.canManageProject = false;
    renderCard();

    expect(screen.queryByRole("button", { name: /add slack connection/i })).not.toBeInTheDocument();
  });
});
