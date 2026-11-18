/**
 * @vitest-environment jsdom
 * Spec: modules/authz/specs/braids-screen.feature
 */

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/trace-client", async () => ({
  traceClient: (await import("./braids-api-fake.ts")).braidTraces.traceClient,
}));
vi.mock("../../../../behavior/authz-api.ts", async () => ({
  authzApi: (await import("./braids-api-fake.ts")).braidsFake.api,
}));

// Isolation is off: reload so the screen binds this file's mock, not a sibling suite's.
vi.resetModules();
const { braidsFake, liveBraid, STRUCTURE } = await import("./braids-api-fake.ts");
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../../testing.tsx");
const { default: OrganizationBraidsScreen } = await import("../organization-braids.screen.tsx");

function renderAs({
  isEnterprise = true,
  braidsReleased = true,
}: { isEnterprise?: boolean; braidsReleased?: boolean } = {}) {
  const host = new FakeAuthzHost({
    scope: { organizationId: "org-1" },
    grants: new Set(["organization:manage"]),
    plan: { isEnterprise, isLoading: false },
    structure: STRUCTURE,
  });
  return renderWithAuthzHost(<OrganizationBraidsScreen />, host, { braidsReleased });
}

beforeEach(() => {
  braidsFake.state.organization = [
    liveBraid(),
    liveBraid({ braidId: "b-2", ownerProjectId: "p-orch", readerProjectId: "p-spec", where: null }),
  ];
  braidsFake.state.keptToAdmins = false;
  braidsFake.state.braidsEnabled = true;
  braidsFake.state.policyFails = false;
  braidsFake.state.policyLoading = false;
  braidsFake.state.policyRefreshFails = false;
  braidsFake.state.pendingSave = undefined;
  braidsFake.state.saveError = undefined;
  braidsFake.state.policyRefetch.mockClear();
  braidsFake.state.setPolicy.mockClear();
  braidsFake.state.setEnabled.mockClear();
});

describe("OrganizationBraidsScreen", () => {
  describe("given an organisation admin", () => {
    /** @scenario An organisation admin chooses who may braid */
    it("An organisation admin chooses who may braid", async () => {
      const { host } = renderAs();
      const rows = screen.getAllByTestId("organization-braid-row");
      expect(rows).toHaveLength(2);
      expect(within(rows[0]!).getByText("specialists")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("orchestrator")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("Every span")).toBeInTheDocument();
      expect(screen.getByText(/project admins can braid their projects/)).toBeInTheDocument();
      const toggle = screen.getByRole("checkbox", { name: "Keep braids to organisation admins" });
      expect(toggle).not.toBeChecked();
      await userEvent.setup().click(toggle);
      expect(braidsFake.state.setPolicy).toHaveBeenCalledWith({
        organizationId: "org-1",
        braidsOrganizationAdminsOnly: true,
      });
      expect(host.successes[0]?.title).toBe("Braids are kept to organisation admins");
    });

    it.each([
      { saving: "who may braid", pendingSave: "policy" as const },
      { saving: "Enable Braids", pendingSave: "enabled" as const },
    ])("holds both switches while the $saving save is pending", ({ pendingSave }) => {
      braidsFake.state.pendingSave = pendingSave;
      renderAs();

      expect(screen.getByRole("checkbox", { name: "Enable Braids" })).toBeDisabled();
      expect(
        screen.getByRole("checkbox", { name: "Keep braids to organisation admins" }),
      ).toBeDisabled();
    });

    /** @scenario An organisation admin chooses who may braid */
    it("links the guide under the description, with no header buttons", () => {
      renderAs();
      const links = screen.getByTestId("braids-page-links");
      expect(within(links).getByRole("link", { name: /How braids work/ })).toHaveAttribute(
        "href",
        "https://langwatch.ai/docs/features/braids",
      );
      expect(within(links).queryByTestId("braids-organization-link")).not.toBeInTheDocument();
    });

    it("Below Enterprise the setting shows the upsell, not a dead control", () => {
      renderAs({ isEnterprise: false });
      expect(screen.getByTestId("braids-policy-upsell")).toHaveTextContent(
        /included in Enterprise/,
      );
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.getByText("Braids are paused")).toBeInTheDocument();
    });

    /** @scenario After leaving Enterprise the page says braids are paused and kept */
    it("says an organisation admin must also turn Braids on when it is off", () => {
      braidsFake.state.braidsEnabled = false;
      renderAs({ isEnterprise: false });
      const banner = screen.getByTestId("braids-plan-paused");
      expect(banner).toHaveTextContent(
        /once you upgrade and an organisation admin turns Braids on/,
      );
      expect(banner).not.toHaveTextContent(/when you upgrade\./);
    });
  });

  describe("given the organisation has Braids turned off", () => {
    /** @scenario An organisation admin turns Braids on at the top of the organisation Braids page */
    it("puts the Enable Braids switch above who may braid, saying what on and off do", async () => {
      braidsFake.state.braidsEnabled = false;
      const { host } = renderAs();

      const sections = screen.getAllByRole("heading").map((heading) => heading.textContent);
      expect(sections.indexOf("Enable Braids")).toBeGreaterThanOrEqual(0);
      expect(sections.indexOf("Enable Braids")).toBeLessThan(sections.indexOf("Who may braid"));
      const row = screen.getByTestId("braids-enabled-row");
      expect(row).toHaveTextContent(/projects can braid/i);
      expect(row).toHaveTextContent(/pauses every braid and keeps it/);
      const toggle = screen.getByRole("checkbox", { name: "Enable Braids" });
      expect(toggle).not.toBeChecked();
      await userEvent.setup().click(toggle);
      expect(braidsFake.state.setEnabled).toHaveBeenCalledWith({
        organizationId: "org-1",
        braidsEnabled: true,
      });
      expect(host.successes[0]?.title).toBe("Braids is on");
    });

    /** @scenario The Enable Braids row offers Retry while the setting can't be read */
    it("shows no switch and offers Retry when the setting fails to load", async () => {
      braidsFake.state.policyFails = true;
      renderAs();

      const row = screen.getByTestId("braids-enabled-row");
      expect(row).toHaveTextContent(/Couldn't read whether Braids is on/);
      expect(screen.queryByRole("checkbox", { name: "Enable Braids" })).toBeNull();
      await userEvent.setup().click(within(row).getByRole("button", { name: "Retry" }));
      expect(braidsFake.state.policyRefetch).toHaveBeenCalledOnce();
    });

    it("keeps the setting as last read, held, with Retry when a refresh fails", async () => {
      braidsFake.state.braidsEnabled = true;
      braidsFake.state.policyRefreshFails = true;
      renderAs();

      const row = screen.getByTestId("braids-enabled-row");
      expect(row).toHaveTextContent(/Couldn't refresh whether Braids is on/);
      const toggle = within(row).getByRole("checkbox", { name: "Enable Braids" });
      expect(toggle).toBeChecked();
      expect(toggle).toBeDisabled();
      await userEvent.setup().click(within(row).getByRole("button", { name: "Retry" }));
      expect(braidsFake.state.policyRefetch).toHaveBeenCalledOnce();
    });

    /** @scenario The Enable Braids row shows no switch until the setting is read */
    it("shows a placeholder and no switch while the setting is still loading", () => {
      braidsFake.state.policyLoading = true;
      renderAs();

      const row = screen.getByTestId("braids-enabled-row");
      expect(within(row).getByTestId("braids-enabled-loading")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "Enable Braids" })).toBeNull();
      expect(within(row).queryByRole("button", { name: "Retry" })).toBeNull();
    });

    /** @scenario While Braids is off the organisation page lists its braids as paused */
    it("lists every braid marked paused", () => {
      braidsFake.state.braidsEnabled = false;
      renderAs();

      for (const row of screen.getAllByTestId("organization-braid-row")) {
        expect(row).toHaveTextContent(/Paused · /);
      }
    });
  });

  describe("given an organisation below Enterprise", () => {
    /** @scenario Below Enterprise the organisation Braids page offers the upsell instead of the switch */
    it("offers See plans in the Enable Braids row and no switch", () => {
      braidsFake.state.braidsEnabled = false;
      renderAs({ isEnterprise: false });

      const row = screen.getByTestId("braids-enabled-row");
      expect(row).toHaveTextContent(/Braids is included in Enterprise/);
      expect(within(row).getByRole("link", { name: "See plans" })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "Enable Braids" })).toBeNull();
    });
  });

  describe("given release_braids is off for the organisation", () => {
    /** @scenario "With release_braids off both Braids pages open read-only" */
    it("lists every braid under the not-enabled notice, with no setting of who may braid", () => {
      renderAs({ braidsReleased: false });

      expect(screen.getByTestId("braids-not-enabled")).toHaveTextContent(
        /not enabled.*still apply.*remove them/,
      );
      expect(screen.getByTestId("organization-braids")).toBeInTheDocument();
      expect(screen.queryByText("Who may braid")).not.toBeInTheDocument();
      expect(screen.queryByText("Braids are paused")).not.toBeInTheDocument();
    });

    /** @scenario With release_braids off and Braids turned off the pages say the braids are paused */
    it("says the braids are paused and kept, and lists each paused", () => {
      braidsFake.state.braidsEnabled = false;
      renderAs({ braidsReleased: false });

      const banner = screen.getByTestId("braids-not-enabled");
      expect(banner).toHaveTextContent(/paused and kept/);
      expect(banner).not.toHaveTextContent(/still apply/);
      for (const row of screen.getAllByTestId("organization-braid-row")) {
        expect(row).toHaveTextContent(/Paused · /);
      }
    });

    it("offers the Enable Braids switch only while Braids is on, so it can be turned off", async () => {
      const { unmount } = renderAs({ braidsReleased: false });
      await userEvent.setup().click(screen.getByRole("checkbox", { name: "Enable Braids" }));
      expect(braidsFake.state.setEnabled).toHaveBeenCalledWith({
        organizationId: "org-1",
        braidsEnabled: false,
      });

      unmount();
      renderAs({ braidsReleased: false });
      expect(screen.queryByRole("checkbox", { name: "Enable Braids" })).toBeNull();
    });

    it("keeps the Enable Braids switch when turning Braids off is refused", async () => {
      braidsFake.state.saveError = new Error("network down");
      const { unmount, host } = renderAs({ braidsReleased: false });
      await userEvent.setup().click(screen.getByRole("checkbox", { name: "Enable Braids" }));
      expect(braidsFake.state.setEnabled).toHaveBeenCalledWith({
        organizationId: "org-1",
        braidsEnabled: false,
      });
      expect(host.successes).toHaveLength(0);
      expect(host.failures).toEqual([
        { error: braidsFake.state.saveError, fallbackTitle: "Couldn't turn Braids on or off" },
      ]);

      unmount();
      renderAs({ braidsReleased: false });
      expect(screen.getByRole("checkbox", { name: "Enable Braids" })).toBeChecked();
    });

    it("offers no Enable Braids switch once Braids is off", () => {
      braidsFake.state.braidsEnabled = false;
      renderAs({ braidsReleased: false });

      expect(screen.queryByRole("checkbox", { name: "Enable Braids" })).toBeNull();
    });

    /** @scenario With release_braids off the Enable Braids row offers Retry when the setting can't be read */
    it("says the setting couldn't be read and offers Retry, with no switch", async () => {
      braidsFake.state.policyFails = true;
      renderAs({ braidsReleased: false });

      const row = screen.getByTestId("braids-enabled-row");
      expect(row).toHaveTextContent(/Couldn't read whether Braids is on/);
      expect(screen.queryByRole("checkbox", { name: "Enable Braids" })).toBeNull();
      await userEvent.setup().click(within(row).getByRole("button", { name: "Retry" }));
      expect(braidsFake.state.policyRefetch).toHaveBeenCalledOnce();
    });

    it("says neither that braids apply nor that they are paused while the setting is unread", () => {
      braidsFake.state.policyFails = true;
      renderAs({ braidsReleased: false });

      const banner = screen.getByTestId("braids-not-enabled");
      expect(banner).toHaveTextContent(/Couldn't read whether your organisation has Braids on/);
      expect(banner).not.toHaveTextContent(/still apply/);
      expect(banner).toHaveTextContent(/remove them from each project's Braids page/);
    });

    describe.each([
      { setting: "on", braidsEnabled: true, resumes: /when you upgrade\./ },
      { setting: "off", braidsEnabled: false, resumes: /an organisation admin turns Braids on/ },
    ])(
      "and the organisation is below Enterprise with Braids $setting",
      ({ braidsEnabled, resumes }) => {
        /** @scenario With release_braids off below Enterprise the pages say the braids are paused by the plan */
        it("says the braids are paused by the plan, not applying, and lists each paused", () => {
          braidsFake.state.braidsEnabled = braidsEnabled;
          renderAs({ isEnterprise: false, braidsReleased: false });

          const notice = screen.getByTestId("braids-not-enabled");
          expect(notice).toHaveTextContent(/paused and kept, since they need the Enterprise plan/);
          expect(notice).not.toHaveTextContent(/still apply/);
          expect(screen.getByTestId("braids-plan-paused")).toHaveTextContent(resumes);
          expect(screen.getByTestId("braids-enterprise-badge")).toBeInTheDocument();
          for (const row of screen.getAllByTestId("organization-braid-row")) {
            expect(row).toHaveTextContent(/Paused · /);
          }
        });
      },
    );
  });

  describe("given a phone-width screen", () => {
    function minWidthPx(query: string): number {
      const found = /min-width:\s*([\d.]+)(px|rem|em)/.exec(query);
      if (!found) return 0;
      return Number(found[1]) * (found[2] === "px" ? 1 : 16);
    }

    /** Every `min-width` query answers as a 390 px screen would. */
    function viewport({ wide }: { wide: boolean }) {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: wide || minWidthPx(query) <= 390,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }));
    }

    afterEach(() => vi.unstubAllGlobals());

    /** @scenario The organisation's braids read on a phone-width screen */
    it("stacks each braid's projects, condition and window in one row", async () => {
      viewport({ wide: false });
      renderAs();

      const table = await screen.findByTestId("organization-braids-stacked");
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((h) => h.textContent),
      ).toEqual(["Braid", "Actions"]);
      const [first, second] = screen.getAllByTestId("organization-braid-row");
      expect(within(first!).getByText("specialists")).toBeInTheDocument();
      expect(within(first!).getByText("orchestrator")).toBeInTheDocument();
      expect(within(first!).getByTestId("braid-window-from")).toBeInTheDocument();
      expect(within(second!).getByText("Every span")).toBeInTheDocument();
    });

    /** @scenario Each braid row shows where it goes, its condition, its access and its activity */
    it("names each row's menu apart from the others", () => {
      viewport({ wide: true });
      renderAs();

      const names = screen
        .getAllByRole("button", { name: /^Actions for the braid/ })
        .map((button) => button.getAttribute("aria-label"));
      expect(new Set(names).size).toBe(names.length);
      expect(screen.queryByTestId("organization-braids-stacked")).toBeNull();
    });
  });
});
