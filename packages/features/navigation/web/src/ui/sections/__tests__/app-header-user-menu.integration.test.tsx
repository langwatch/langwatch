/**
 * @vitest-environment jsdom
 *
 * The avatar menu's navigation-mode picker.
 *
 * MOVED from `platform/app`. The seven mocks that named that application's
 * hooks are the stub host now; the picker itself no longer sits behind a flag,
 * so what this asserts is that it is there and offers exactly the two shells.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

let governanceByOrg: Record<string, boolean> = {};

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: () => ({ data: { enabledByOrganizationId: governanceByOrg } }),
      },
    },
  },
}));

import { WithStubNavigationHost, type StubNavigationReadings } from "../../../testing.tsx";
import { AppHeaderUserMenu } from "../app-header-user-menu.tsx";

const rememberScopeMock = vi.fn();
const navigateMock = vi.fn();

const renderMenu = (readings: Partial<StubNavigationReadings> = {}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          currentUser: { id: "user-1", name: "Ada", email: "ada@example.com", image: null },
          organization: { id: "org-1", name: "Acme", teams: [] },
          ...readings,
        }}
        actions={{ rememberScope: rememberScopeMock, navigate: navigateMock }}
      >
        <AppHeaderUserMenu />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
  governanceByOrg = {};
  rememberScopeMock.mockClear();
  navigateMock.mockClear();
});

describe("given a reader who never picked a navigation mode", () => {
  describe("when the avatar menu is opened", () => {
    /** @scenario The avatar menu offers the two navigation modes */
    it("shows the default mode and offers Product switcher and Icon rail", async () => {
      const user = userEvent.setup();
      renderMenu();

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));
      const trigger = await screen.findByText(/^Navigation \(/);
      expect(trigger.textContent).toContain("Product switcher");

      await user.hover(trigger);
      const submenu = await screen.findAllByRole("menuitemradio");
      const labels = submenu.map((item) => item.textContent);
      expect(labels).toEqual(expect.arrayContaining(["Product switcher", "Icon rail"]));
    });
  });
});

describe("the My Workspace entry's governance gate", () => {
  describe("given every organization the reader belongs to has governance off", () => {
    /** @scenario The personal entry is hidden when no organization enables governance */
    it("shows no My Workspace row", async () => {
      const user = userEvent.setup();
      governanceByOrg = { "org-1": false, "org-2": false };
      renderMenu({
        organizations: [
          { id: "org-1", name: "Acme", teams: [] },
          { id: "org-2", name: "Globex", teams: [] },
        ],
      });

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));

      expect(screen.queryByText("My Workspace")).toBeNull();
    });
  });

  describe("given at least one organization enables governance", () => {
    /** @scenario The personal entry shows when any organization enables governance */
    it("shows a My Workspace row", async () => {
      const user = userEvent.setup();
      governanceByOrg = { "org-1": true, "org-2": false };
      renderMenu({
        organizations: [
          { id: "org-1", name: "Acme", teams: [] },
          { id: "org-2", name: "Globex", teams: [] },
        ],
      });

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));

      expect(screen.getByText("My Workspace")).not.toBeNull();
    });
  });

  describe("given exactly one organization enables governance", () => {
    /** @scenario With a single governance organization, My Workspace links to /me */
    it("writes that organization into scope and opens /me when picked", async () => {
      const user = userEvent.setup();
      governanceByOrg = { "org-1": true };
      renderMenu({ organizations: [{ id: "org-1", name: "Acme", teams: [] }] });

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));
      await user.click(screen.getByText("My Workspace"));

      expect(rememberScopeMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectSlug: "",
      });
      expect(navigateMock).toHaveBeenCalledWith("/me");
    });

    /** @scenario A single governance organization still shows its name with My Workspace nested under it */
    it("shows that organization's name with My Workspace nested under it", async () => {
      const user = userEvent.setup();
      governanceByOrg = { "org-1": true };
      renderMenu({ organizations: [{ id: "org-1", name: "Acme", teams: [] }] });

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));

      expect(screen.getByText("Acme")).not.toBeNull();
      expect(screen.getByText("My Workspace")).not.toBeNull();
    });
  });

  describe("given more than one organization enables governance", () => {
    /** @scenario My Workspace nests under each governance-enabled organization */
    it("renders a My Workspace row under each governance organization's name", async () => {
      const user = userEvent.setup();
      governanceByOrg = { "org-1": true, "org-2": true };
      renderMenu({
        organizations: [
          { id: "org-1", name: "Acme", teams: [] },
          { id: "org-2", name: "Globex", teams: [] },
        ],
      });

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));

      expect(screen.getByText("Acme")).not.toBeNull();
      expect(screen.getByText("Globex")).not.toBeNull();
      expect(screen.getAllByText("My Workspace")).toHaveLength(2);
    });

    /** @scenario With multiple governance organizations, each My Workspace carries its org */
    it("writes the picked organization's own id into scope", async () => {
      const user = userEvent.setup();
      governanceByOrg = { "org-1": true, "org-2": true };
      renderMenu({
        organizations: [
          { id: "org-1", name: "Acme", teams: [] },
          { id: "org-2", name: "Globex", teams: [] },
        ],
      });

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));
      const [, globexEntry] = screen.getAllByText("My Workspace");
      await user.click(globexEntry!);

      expect(rememberScopeMock).toHaveBeenCalledWith({
        organizationId: "org-2",
        projectSlug: "",
      });
    });
  });

  describe("given one organization has governance off among others that have it on", () => {
    /** @scenario An organization without governance shows no My Workspace row */
    it("shows no My Workspace row under that organization", async () => {
      const user = userEvent.setup();
      governanceByOrg = { "org-1": true, "org-2": false };
      renderMenu({
        organizations: [
          { id: "org-1", name: "Acme", teams: [] },
          { id: "org-2", name: "Globex", teams: [] },
        ],
      });

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));

      expect(screen.getByText("Acme")).not.toBeNull();
      expect(screen.queryByText("Globex")).toBeNull();
      expect(screen.getAllByText("My Workspace")).toHaveLength(1);
    });
  });
});
