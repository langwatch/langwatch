/**
 * @vitest-environment jsdom
 * Spec: modules/authz/specs/braids-screen.feature
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/trace-client", async () => ({
  traceClient: (await import("./braids-api-fake.ts")).braidTraces.traceClient,
}));
vi.mock("../../../../behavior/authz-api.ts", async () => ({
  authzApi: (await import("./braids-api-fake.ts")).braidsFake.api,
}));

// Isolation is off: reload so the screen binds this file's mock, not a sibling suite's.
vi.resetModules();
const { braidsFake, braidTraces, liveBraid, STRUCTURE } = await import("./braids-api-fake.ts");
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../../testing.tsx");
const { default: BraidsScreen } = await import("../braids.screen.tsx");

const ADMIN = new Set(["project:view", "braids:manage"]);
const MEMBER = new Set(["project:view"]);

function renderAs({
  grants = ADMIN,
  isEnterprise = true,
  projectId = "p-spec",
  query = {},
}: {
  grants?: Set<string>;
  isEnterprise?: boolean;
  projectId?: string;
  query?: Record<string, string>;
} = {}) {
  const host = new FakeAuthzHost({
    scope: { organizationId: "org-1", projectId },
    grants,
    plan: { isEnterprise, isLoading: false },
    structure: STRUCTURE,
    query,
  });
  return renderWithAuthzHost(<BraidsScreen />, host);
}

beforeEach(() => {
  const { state } = braidsFake;
  state.project = { intoOtherProjects: [], fromOtherProjects: [] };
  state.keptToAdmins = false;
  state.remove.mockClear();
});

async function openRowMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("braid-row-actions"));
  return user;
}

describe("BraidsScreen", () => {
  describe("given an Enterprise organisation", () => {
    /** @scenario A project with no braids shows how braids work */
    it("A project with no braids shows how braids work", () => {
      renderAs();
      const steps = screen.getByTestId("braids-steps");
      expect(within(steps).getByText("1. Tag the call")).toBeInTheDocument();
      expect(within(steps).getByText("2. Copy the tag")).toBeInTheDocument();
      expect(within(steps).getByText("3. Braid")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /New braid/ }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: /How braids work/ })[0]).toHaveAttribute(
        "href",
        "https://langwatch.ai/docs/features/braids",
      );
      expect(screen.getByRole("tab", { name: /Into other projects/ })).toHaveTextContent("0");
      expect(screen.getByRole("tab", { name: /From other projects/ })).toHaveTextContent("0");
      expect(screen.getByRole("tab", { name: /Signing keys/ })).toBeInTheDocument();
    });
    /** @scenario Each braid row shows where it goes, its condition, its access and its activity */
    it("Each braid row shows where it goes, its condition, its access and its activity", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      braidTraces.state.activity = [{ braidId: "b-1", spanCount: 1204 }];
      renderAs();
      const row = screen.getByTestId("braid-row");
      expect(within(row).getByText("orchestrator")).toBeInTheDocument();
      expect(within(row).getByText('attributes["orchestrator"] == "web"')).toBeInTheDocument();
      expect(within(row).getByText("From 1 Oct 2026")).toBeInTheDocument();
      expect(within(row).getByText("Until 31 Dec 2026")).toBeInTheDocument();
      expect(within(row).getByTestId("braid-activity")).toHaveTextContent("1,204 spans in 24h");
      await openRowMenu();
      expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "View in audit log" })).toHaveAttribute(
        "href",
        "/settings/audit-log?targetKind=braid&targetId=b-1",
      );
      expect(screen.getByRole("menuitem", { name: "Remove braid" })).toBeInTheDocument();
    });

    /** @scenario Removing a braid says what stops before it happens */
    it("Removing a braid says what stops before it happens", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      const { host } = renderAs();
      const user = await openRowMenu();
      await user.click(await screen.findByRole("menuitem", { name: "Remove braid" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("Remove braid into orchestrator?")).toBeInTheDocument();
      expect(
        within(dialog).getByText(/orchestrator stops seeing specialists spans/),
      ).toHaveTextContent(/audit log/);
      await user.click(within(dialog).getByRole("button", { name: "Remove braid" }));
      expect(braidsFake.state.remove).toHaveBeenCalledWith({ projectId: "p-spec", braidId: "b-1" });
      await waitFor(() => expect(host.successes[0]?.title).toBe("Braid removed"));
    });

    it("opens on Signing keys when the link names that tab, and writes a picked tab back", async () => {
      const { host } = renderAs({ query: { tab: "keys" } });

      expect(await screen.findByRole("tab", { name: /Signing keys/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole("tab", { name: /From other projects/ }));
      expect(screen.getByRole("tab", { name: /From other projects/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(host.queries.at(-1)).toEqual({ tab: "from" });
    });

    /** @scenario The reader's admins may remove a braid from their side but not change it */
    it("The reader's admins may remove a braid from their side but not change it", async () => {
      braidsFake.state.project = { intoOtherProjects: [], fromOtherProjects: [liveBraid()] };
      const user = userEvent.setup();
      renderAs({ projectId: "p-orch" });
      await user.click(screen.getByRole("tab", { name: /From other projects/ }));
      const row = await screen.findByTestId("braid-row");
      expect(within(row).getByText("specialists")).toBeInTheDocument();
      expect(within(row).getByText('attributes["orchestrator"] == "web"')).toBeInTheDocument();
      await user.click(within(row).getByTestId("braid-row-actions"));
      expect(await screen.findByRole("menuitem", { name: "Remove braid" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
    });

    /** @scenario A project admin is told when the organisation keeps braids to its admins */
    it("A project admin is told when the organisation keeps braids to its admins", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      braidsFake.state.keptToAdmins = true;
      renderAs({ grants: MEMBER });
      expect(screen.getByText("Your organisation's admins manage braids")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ask an admin" })).toHaveAttribute(
        "href",
        "/settings/directory",
      );
      expect(screen.getByTestId("braid-row")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
      await openRowMenu();
      expect(
        await screen.findByRole("menuitem", { name: "View in audit log" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Remove braid" })).not.toBeInTheDocument();
    });

    /** @scenario A member who is not an admin sees the braids but cannot change them */
    it("A member who is not an admin sees the braids but cannot change them", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      renderAs({ grants: MEMBER });
      expect(screen.getByTestId("braid-row")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
      expect(
        screen.queryByText("Your organisation's admins manage braids"),
      ).not.toBeInTheDocument();
      await openRowMenu();
      expect(
        await screen.findByRole("menuitem", { name: "View in audit log" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Remove braid" })).not.toBeInTheDocument();
    });
  });

  describe("given an organisation below Enterprise", () => {
    /** @scenario An organisation below Enterprise sees what Braids offers */
    it("An organisation below Enterprise sees what Braids offers", () => {
      renderAs({ isEnterprise: false });
      const upsell = screen.getByTestId("braids-enterprise-upsell");
      expect(within(upsell).getByText("See every agent call, across projects")).toBeInTheDocument();
      expect(
        within(upsell).getByRole("link", { name: "Talk to us about Enterprise" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
    });

    /** @scenario After leaving Enterprise the page says braids are paused and kept */
    it("After leaving Enterprise the page says braids are paused and kept", () => {
      braidsFake.state.project = {
        intoOtherProjects: [liveBraid(), liveBraid({ braidId: "b-2" })],
        fromOtherProjects: [],
      };
      renderAs({ isEnterprise: false });
      expect(screen.getByText("Braids are paused")).toBeInTheDocument();
      expect(screen.getByText(/start working again when you upgrade/)).toBeInTheDocument();
      const rows = screen.getAllByTestId("braid-row");
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(within(row).getByTestId("braid-paused")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
    });
  });
});
