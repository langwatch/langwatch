/**
 * @vitest-environment jsdom
 * Spec: modules/authz/specs/braids-screen.feature
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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

const SLUGGED = {
  ...STRUCTURE,
  projects: STRUCTURE.projects.map((project) => ({ ...project, slug: `${project.name}-x2` })),
};

const ADMIN = new Set(["project:view", "braids:manage"]);
const MEMBER = new Set(["project:view"]);

function renderAs({
  grants = ADMIN,
  isEnterprise = true,
  projectId = "p-spec",
  query = {},
  projectSwitcher,
  structure = STRUCTURE,
}: {
  structure?: typeof STRUCTURE;
  grants?: Set<string>;
  isEnterprise?: boolean;
  projectId?: string;
  query?: Record<string, string>;
  projectSwitcher?: ReactNode;
} = {}) {
  const host = new FakeAuthzHost({
    scope: { organizationId: "org-1", projectId },
    grants,
    plan: { isEnterprise, isLoading: false },
    structure,
    query,
    projectSwitcher,
  });
  return renderWithAuthzHost(<BraidsScreen />, host);
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
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
    /** @scenario The project Braids page header offers the project switcher */
    it("The project Braids page header offers the project switcher", () => {
      renderAs({ projectSwitcher: <button type="button">specialists</button> });
      expect(screen.getByRole("button", { name: "specialists" })).toBeInTheDocument();
    });

    /** @scenario A project with no braids says what a braid does */
    it("A project with no braids says what a braid does", () => {
      renderAs();
      const empty = screen.getByTestId("braids-empty-into");
      expect(within(empty).getByText("Not braided into any project")).toBeInTheDocument();
      expect(within(empty).getByText(/inside another project's traces/)).toBeInTheDocument();
      expect(within(empty).getByRole("link", { name: /Read the docs/ })).toHaveAttribute(
        "href",
        "https://langwatch.ai/docs/features/braids",
      );
      expect(screen.getByRole("button", { name: /New braid/ })).toBeInTheDocument();
      const links = screen.getByTestId("braids-page-links");
      expect(within(links).getByRole("link", { name: /How braids work/ })).toHaveAttribute(
        "href",
        "https://langwatch.ai/docs/features/braids",
      );
      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
      expect(screen.queryByTestId("braids-section-into")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Signing keys" })).toBeInTheDocument();
    });

    /** @scenario A project with no braids says what a braid does */
    it("offers only the project switcher and New braid as header buttons", () => {
      renderAs({
        grants: new Set([...ADMIN, "organization:manage"]),
        projectSwitcher: <button type="button">specialists</button>,
      });
      const header = screen.getByTestId("new-braid-header").parentElement;
      expect(header).not.toBeNull();
      expect(
        within(header as HTMLElement)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["specialists", "New braid"]);
    });

    /** @scenario The page stacks its braids and signing keys in titled sections */
    it("The page stacks its braids and signing keys in titled sections", () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      renderAs();
      expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
        "Shown in other projects",
        "Shown here from other projects",
        "Signing keys",
      ]);
      expect(screen.getByTestId("braids-count-into")).toHaveTextContent("1");
      expect(screen.getByTestId("braids-count-from")).toHaveTextContent("0");
      expect(
        within(screen.getByTestId("braids-section-into")).getByTestId("braid-row"),
      ).toBeVisible();
      expect(screen.getByTestId("braids-none-from")).toHaveTextContent(
        "No project shows its spans in specialists yet.",
      );
      expect(screen.queryByTestId("braids-empty-into")).not.toBeInTheDocument();
    });
    /** @scenario Each braid row shows where it goes, its condition, its access and its activity */
    it("Each braid row shows where it goes, its condition, its access and its activity", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      braidTraces.state.activity = [{ braidId: "b-1", spanCount: 1204 }];
      renderAs();
      const row = screen.getByTestId("braid-row");
      expect(within(row).getByText("orchestrator")).toBeInTheDocument();
      expect(within(row).getByTitle('attributes["orchestrator"] == "web"')).toBeInTheDocument();
      expect(within(row).getByTestId("braid-window-from")).toHaveTextContent(/^From .*2026$/);
      expect(within(row).getByTestId("braid-window-until")).toHaveTextContent(/^Until .*2026$/);
      expect(within(row).getByText(/^Created/)).toBeInTheDocument();
      expect(within(row).getByTestId("braid-activity")).toHaveTextContent(/^1\.2K spans$/);
      await openRowMenu();
      expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "View in audit log" })).toHaveAttribute(
        "href",
        `/settings/audit-log?${new URLSearchParams({
          targetKind: "braid",
          targetId: "b-1",
          targetLabel: "specialists → orchestrator",
        }).toString()}`,
      );
      expect(screen.getByRole("menuitem", { name: "Remove braid" })).toBeInTheDocument();
    });

    /** @scenario Each braid row shows where it goes, its condition, its access and its activity */
    it("links an into row straight to the audit log, with no switch into its own project", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      renderAs({ structure: SLUGGED });
      await openRowMenu();
      expect(await screen.findByRole("menuitem", { name: "View in audit log" })).toHaveAttribute(
        "href",
        expect.stringMatching(/^\/settings\/audit-log\?/),
      );
    });

    it("links a from row through the owner's project, where the braid's entries are kept", async () => {
      braidsFake.state.project = { intoOtherProjects: [], fromOtherProjects: [liveBraid()] };
      const user = userEvent.setup();
      renderAs({ projectId: "p-orch", structure: SLUGGED });
      await user.click(
        within(await screen.findByTestId("braid-row")).getByTestId("braid-row-actions"),
      );
      expect(await screen.findByRole("menuitem", { name: "View in audit log" })).toHaveAttribute(
        "href",
        expect.stringMatching(/^\/specialists-x2\?return_to=%2Fsettings%2Faudit-log/),
      );
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

    /** @scenario The Signing keys section opens New signing key */
    it("The Signing keys section opens New signing key", async () => {
      const { host } = renderAs();
      const user = userEvent.setup();

      await user.click(
        within(screen.getByTestId("braids-section-keys")).getByRole("button", {
          name: /New signing key/,
        }),
      );

      expect(host.queries.at(-1)).toEqual({ signingKey: "new" });
    });

    /** @scenario The Signing keys section opens New signing key */
    it("offers no New signing key to whoever cannot manage keys", () => {
      renderAs({ grants: MEMBER });
      expect(screen.queryByTestId("new-signing-key")).not.toBeInTheDocument();
    });

    /** @scenario The project Braids page links to every braid in the organisation */
    it("links to every braid in the organisation for whoever may open that view", () => {
      renderAs({ grants: new Set([...ADMIN, "organization:manage"]) });

      const links = screen.getByTestId("braids-page-links");
      expect(within(links).getByRole("link", { name: "All braids in Acme" })).toHaveAttribute(
        "href",
        "/settings/organization-braids",
      );
    });

    /** @scenario The project Braids page links to every braid in the organisation */
    it("offers no organisation link to someone who cannot open that view", () => {
      renderAs({ grants: MEMBER });

      expect(screen.queryByTestId("braids-organization-link")).not.toBeInTheDocument();
    });

    it("scrolls to the section a link names, once the braids are in", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      renderAs({ query: { section: "keys" } });
      const keys = screen.getByTestId("braids-section-keys");
      await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(keys));
    });

    /** @scenario The reader's admins may remove a braid from their side but not change it */
    it("The reader's admins may remove a braid from their side but not change it", async () => {
      braidsFake.state.project = { intoOtherProjects: [], fromOtherProjects: [liveBraid()] };
      const user = userEvent.setup();
      renderAs({ projectId: "p-orch" });
      const row = within(screen.getByTestId("braids-section-from")).getByTestId("braid-row");
      expect(within(row).getByText("specialists")).toBeInTheDocument();
      expect(within(row).getByTitle('attributes["orchestrator"] == "web"')).toBeInTheDocument();
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
      expect(screen.queryByTestId("braids-section-keys")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /How braids work/ })).toHaveLength(1);
    });

    /** @scenario An organisation below Enterprise sees what Braids offers */
    it("marks the title with the Enterprise lock, as the settings menu does", () => {
      renderAs({ isEnterprise: false });

      const badge = screen.getByTestId("braids-enterprise-badge");
      expect(within(badge).getByLabelText("Enterprise")).toBeInTheDocument();
      expect(badge).not.toHaveTextContent("Enterprise");
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
      for (const row of rows) {
        expect(within(row).getAllByText("Paused")).toHaveLength(1);
        expect(within(row).getByTestId("braid-paused")).toBeInTheDocument();
        expect(within(row).queryByTestId("braid-activity")).not.toBeInTheDocument();
      }
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
      expect(screen.getByTestId("braids-none-from")).toBeInTheDocument();
      expect(screen.getByTestId("braids-signing-keys-paused")).toBeInTheDocument();
      expect(screen.queryByTestId("new-signing-key")).not.toBeInTheDocument();
    });
  });
});
