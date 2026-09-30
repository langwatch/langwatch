/**
 * @vitest-environment jsdom
 * specs/automations/list-pages.feature: the Slack delivery cell on the unified
 * table, and the Overview's create menu.
 */
import type * as SlackKit from "@langwatch/slack-browser-kit";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import type { AutomationSection } from "../automations-layout.tsx";
import { AutomationsPage } from "../automations-screen.tsx";
import type * as ListPagesFixture from "./list-pages.fixture.ts";

vi.mock("../../../behavior/automation-session.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project", name: "Test Project" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

vi.mock("../../../behavior/automation-api.ts", async () => {
  const fixture = await vi.importActual<typeof ListPagesFixture>("./list-pages.fixture.ts");
  return { api: fixture.listPagesApi() };
});

vi.mock("@langwatch/slack-browser-kit", async (importOriginal) => {
  const fixture = await vi.importActual<typeof ListPagesFixture>("./list-pages.fixture.ts");
  return { ...(await importOriginal<typeof SlackKit>()), slackApi: fixture.listPagesSlackApi() };
});

function renderPage(section: AutomationSection) {
  const host = fakeAutomationHost({ permissions: ["triggers:manage"], query: {} });
  const view = renderWithAutomationHost(<AutomationsPage section={section} />, { host });
  return { host, view };
}

describe("given a Slack automation on the unified table", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when a row is a bot-delivery Slack automation", () => {
    /** @scenario The delivery cell names a bot-delivery Slack automation */
    it("names the Slack app and its destination channel, not 'Webhook'", () => {
      renderPage("automations");

      const cell = screen.getByText("Slack app · channel C0999999");
      const row = cell.closest("tr");
      expect(row).not.toBeNull();
      expect(within(row ?? document.body).queryByText("Webhook")).toBeNull();
    });
  });

  describe("when a row is a legacy webhook-delivery Slack automation", () => {
    it("keeps the existing webhook presentation", () => {
      renderPage("automations");

      expect(screen.getByText("Slack webhook")).toBeInTheDocument();
    });
  });
});

describe("given the Overview tab", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the user opens the create menu", () => {
    /** @scenario "The Overview offers creating an automation or a report" */
    it("offers an automation and a report, and no longer an alert", async () => {
      const user = userEvent.setup();
      const { host } = renderPage("overview");

      await user.click(screen.getByRole("button", { name: /Create/ }));

      expect(screen.getByRole("menuitem", { name: "New automation" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "New report" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "New alert" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("menuitem", { name: "New automation" }));
      expect(host.recording.drawerOpens.at(-1)).toEqual({ drawer: "automation", params: {} });
    });
  });
});
