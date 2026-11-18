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

    /** @scenario The Enable Braids switch can't be flipped while the setting can't be read */
    it("disables the switch when the setting fails to load", () => {
      braidsFake.state.policyFails = true;
      renderAs();

      expect(screen.getByRole("checkbox", { name: "Enable Braids" })).toBeDisabled();
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

    it("offers the Enable Braids switch only while Braids is on, so it can be turned off", async () => {
      renderAs({ braidsReleased: false });
      await userEvent.setup().click(screen.getByRole("checkbox", { name: "Enable Braids" }));
      expect(braidsFake.state.setEnabled).toHaveBeenCalledWith({
        organizationId: "org-1",
        braidsEnabled: false,
      });
    });

    it("offers no Enable Braids switch once Braids is off", () => {
      braidsFake.state.braidsEnabled = false;
      renderAs({ braidsReleased: false });

      expect(screen.queryByRole("checkbox", { name: "Enable Braids" })).toBeNull();
    });
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
