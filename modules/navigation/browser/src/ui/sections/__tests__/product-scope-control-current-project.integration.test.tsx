/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/project-switcher-current-project.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WithStubNavigationHost, type StubNavigationReadings } from "../../../testing.tsx";
import { ProductScopeControl } from "../product-scope-control.tsx";

const coreTeam = {
  id: "team_1",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
  projects: [
    { id: "project_demo_1", slug: "demo", name: "Demo", isPersonal: false },
    { id: "project_billing_2", slug: "billing-sync", name: "Billing Sync", isPersonal: false },
    {
      id: "project_rollup_3",
      slug: "rollup",
      name: "Rollup",
      isPersonal: false,
      kind: "aggregate",
    },
  ],
};
const organization = { id: "org_1", name: "ACME", teams: [coreTeam] };

const navigateMock = vi.fn();

function renderSwitcher({ readings }: { readings?: Partial<StubNavigationReadings> } = {}) {
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        organizations: [organization],
        organization,
        project: coreTeam.projects[0],
        team: coreTeam,
        openableTeams: [coreTeam],
        currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
        isLoading: false,
        pathname: "/demo",
        ...readings,
      }}
      actions={{ navigate: navigateMock }}
    >
      <ProductScopeControl activeProductId="llm-ops" />
    </WithStubNavigationHost>,
  );
}

async function openSwitcher() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Switch project" }));
  await waitFor(() => {
    expect(screen.getByRole("combobox", { name: "Search projects" })).toHaveFocus();
  });
  return user;
}

function currentProjectHeader() {
  return screen.getByRole("region", { name: "Current project" });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("the project switcher's current project header", () => {
  describe("when the switcher opens in a project", () => {
    /** @scenario The switcher opens on the current project's name and ID */
    it("shows the project's name and ID with a copy button, above the search field", async () => {
      renderSwitcher();
      await openSwitcher();

      const header = currentProjectHeader();
      expect(within(header).getByText("Demo")).toBeInTheDocument();
      expect(within(header).getByTitle("project_demo_1")).toBeInTheDocument();
      expect(within(header).getByRole("button", { name: "Copy project ID" })).toBeInTheDocument();

      const field = screen.getByRole("combobox", { name: "Search projects" });
      const headerPrecedesField =
        header.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(headerPrecedesField).toBeTruthy();
      expect(within(header).queryByRole("option")).not.toBeInTheDocument();
    });

    /** @scenario The switcher opens on the current project's name and ID */
    it("copies the whole ID and stays open, the search field keeping the focus", async () => {
      renderSwitcher();
      const user = await openSwitcher();

      await user.click(
        within(currentProjectHeader()).getByRole("button", { name: "Copy project ID" }),
      );

      expect(await navigator.clipboard.readText()).toBe("project_demo_1");
      expect(screen.getByRole("combobox", { name: "Search projects" })).toHaveFocus();
    });

    /** @scenario The current project header leads to its settings and its API keys */
    it("links to the project's settings and to the API keys filtered to it", async () => {
      renderSwitcher();
      await openSwitcher();

      const header = currentProjectHeader();
      expect(within(header).getByRole("link", { name: "Project settings" })).toHaveAttribute(
        "href",
        "/settings/project",
      );
      expect(
        within(header).getByRole("link", { name: "API keys for this project" }),
      ).toHaveAttribute("href", "/settings/api-keys?scope=PROJECT%3Aproject_demo_1");
    });
  });

  describe("when the reader follows a link from the header", () => {
    /** @scenario Following a link from the header closes the switcher */
    it("opens the page in place and closes the switcher", async () => {
      renderSwitcher();
      const user = await openSwitcher();

      await user.click(
        within(currentProjectHeader()).getByRole("link", { name: "Project settings" }),
      );

      expect(navigateMock).toHaveBeenCalledWith("/settings/project");
      await waitFor(() => {
        expect(screen.queryByPlaceholderText("Search projects")).not.toBeVisible();
      });
    });
  });

  describe("when the current project is an aggregate", () => {
    /** @scenario An aggregate project shows its ID but offers no API keys */
    it("shows the ID and leaves out the API keys link", async () => {
      renderSwitcher({ readings: { project: coreTeam.projects[2], pathname: "/rollup" } });
      await openSwitcher();

      const header = currentProjectHeader();
      expect(within(header).getByTitle("project_rollup_3")).toBeInTheDocument();
      expect(within(header).getByRole("link", { name: "Project settings" })).toBeInTheDocument();
      expect(
        within(header).queryByRole("link", { name: "API keys for this project" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the reader drives the list from the keyboard", () => {
    /** @scenario The keyboard still drives the project list with the header shown */
    it("opens the typed project on Enter, the search field keeping the focus", async () => {
      renderSwitcher();
      const user = await openSwitcher();
      const field = screen.getByRole("combobox", { name: "Search projects" });

      fireEvent.change(field, { target: { value: "billing" } });
      await waitFor(() => {
        expect(screen.getByRole("option", { name: "Billing Sync" })).toHaveAttribute(
          "data-highlighted",
        );
      });
      expect(field).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining("billing-sync"));
      });
    });
  });
});
