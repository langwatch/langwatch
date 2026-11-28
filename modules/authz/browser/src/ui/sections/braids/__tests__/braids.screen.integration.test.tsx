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
  braidsReleased = true,
}: {
  structure?: typeof STRUCTURE;
  braidsReleased?: boolean;
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
  return renderWithAuthzHost(<BraidsScreen />, host, { braidsReleased });
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  const { state } = braidsFake;
  state.project = { intoOtherProjects: [], fromOtherProjects: [] };
  state.keptToAdmins = false;
  state.braidsEnabled = true;
  state.policyFails = false;
  state.policyLoading = false;
  state.policyRefreshFails = false;
  state.pendingSave = undefined;
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
      const footnote = screen.getByTestId("braids-who-may-braid");
      expect(footnote).toHaveTextContent("Every change is in the audit log.");
      expect(
        within(screen.getByTestId("braids-section-keys")).queryByTestId("braids-who-may-braid"),
      ).toBeNull();
      expect(screen.getByTestId("braids-section-keys").compareDocumentPosition(footnote)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    /** @scenario A braid row says when its last 24 hours could not be counted */
    it("says the spans could not be counted when the count fails", () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      braidTraces.state.activity = "failed";
      renderAs();

      expect(
        within(screen.getByTestId("braid-row")).getByTestId("braid-activity"),
      ).toHaveTextContent("Couldn't count spans");
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
      expect(within(upsell).getByRole("link", { name: "See plans" })).toBeInTheDocument();
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

    /** @scenario After leaving Enterprise the page says braids are paused and kept */
    it("says upgrading alone does not resume braids the organisation turned off", () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      braidsFake.state.braidsEnabled = false;
      renderAs({ isEnterprise: false });
      expect(screen.getByTestId("braids-plan-paused")).toHaveTextContent(
        /Your braid is kept and starts working again once you upgrade and an organisation admin/,
      );
    });

    it("says upgrading resumes braids only if Braids is on while the setting is unread", () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      braidsFake.state.policyFails = true;
      renderAs({ isEnterprise: false });
      expect(screen.getByTestId("braids-plan-paused")).toHaveTextContent(
        /if Braids is on for your organisation/,
      );
    });
  });

  describe("given release_braids is off for the organisation", () => {
    /** @scenario "With release_braids off both Braids pages open read-only" */
    it("says Braids is not enabled and that existing braids still apply and can be removed here", () => {
      renderAs({ braidsReleased: false });

      expect(screen.getByTestId("braids-not-enabled")).toHaveTextContent(
        /not enabled.*still apply.*remove them here/,
      );
    });

    /** @scenario "With release_braids off the project Braids page lists braids with only Remove" */
    it("lists the braid with Remove and the keys section, with no New braid, Edit, New key or setting", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      renderAs({ braidsReleased: false });

      expect(
        within(screen.getByTestId("braids-section-into")).getByTestId("braid-row"),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
      expect(screen.getByTestId("braids-section-keys")).toBeInTheDocument();
      expect(screen.queryByTestId("new-signing-key")).not.toBeInTheDocument();
      expect(screen.queryByTestId("braids-who-may-braid")).not.toBeInTheDocument();
      await openRowMenu();
      expect(await screen.findByRole("menuitem", { name: "Remove braid" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
    });

    /** @scenario With release_braids off and Braids turned off the pages say the braids are paused */
    it("says the braids are paused rather than applying, and marks each paused", () => {
      braidsFake.state.braidsEnabled = false;
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      renderAs({ braidsReleased: false });

      const banner = screen.getByTestId("braids-not-enabled");
      expect(banner).toHaveTextContent(/paused and kept.*remove them here/);
      expect(banner).not.toHaveTextContent(/still apply/);
      expect(screen.queryByTestId("braids-turned-off")).toBeNull();
      const row = within(screen.getByTestId("braids-section-into")).getByTestId("braid-row");
      expect(within(row).getByTestId("braid-paused")).toBeInTheDocument();
    });

    describe.each([
      { setting: "on", braidsEnabled: true, resumes: /when you upgrade\./ },
      { setting: "off", braidsEnabled: false, resumes: /an organisation admin turns Braids on/ },
    ])(
      "and the organisation is below Enterprise with Braids $setting",
      ({ braidsEnabled, resumes }) => {
        /** @scenario With release_braids off below Enterprise the pages say the braids are paused by the plan */
        it("says the braids are paused by the plan, not applying, and marks each paused", () => {
          braidsFake.state.braidsEnabled = braidsEnabled;
          braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
          renderAs({ isEnterprise: false, braidsReleased: false });

          const notice = screen.getByTestId("braids-not-enabled");
          expect(notice).toHaveTextContent(/paused and kept, since they need the Enterprise plan/);
          expect(notice).not.toHaveTextContent(/still apply/);
          expect(screen.getByTestId("braids-plan-paused")).toHaveTextContent(resumes);
          const row = within(screen.getByTestId("braids-section-into")).getByTestId("braid-row");
          expect(within(row).getByTestId("braid-paused")).toBeInTheDocument();
        });
      },
    );
  });

  describe("given the organisation has Braids turned off", () => {
    /** @scenario While Braids is off the project page sends an organisation admin to turn it on */
    it("links an organisation admin to the organisation page and lists the braid paused with only Remove", async () => {
      braidsFake.state.braidsEnabled = false;
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      renderAs({ grants: new Set([...ADMIN, "organization:manage"]) });

      const banner = screen.getByTestId("braids-turned-off");
      expect(banner).toHaveTextContent(/Braids is off for your organisation/);
      expect(banner).toHaveTextContent(/paused and kept/);
      expect(within(banner).getByRole("link", { name: "Turn on Braids" })).toHaveAttribute(
        "href",
        "/settings/organization-braids",
      );
      const row = within(screen.getByTestId("braids-section-into")).getByTestId("braid-row");
      expect(within(row).getByTestId("braid-paused")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
      expect(screen.queryByTestId("new-signing-key")).not.toBeInTheDocument();
      await openRowMenu();
      expect(await screen.findByRole("menuitem", { name: "Remove braid" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
    });

    /** @scenario While Braids is off the project page tells a project admin to ask an organisation admin */
    it("tells a project admin to ask an organisation admin, with no link to the organisation page", () => {
      braidsFake.state.braidsEnabled = false;
      renderAs();

      const banner = screen.getByTestId("braids-turned-off");
      expect(banner).toHaveTextContent(/Ask an organisation admin to turn it on/);
      expect(within(banner).queryByRole("link", { name: "Turn on Braids" })).toBeNull();
      expect(screen.queryByRole("button", { name: /New braid/ })).not.toBeInTheDocument();
    });

    it("keeps the upsell below Enterprise when the organisation has no braids", () => {
      braidsFake.state.braidsEnabled = false;
      renderAs({ isEnterprise: false });

      expect(screen.getByTestId("braids-enterprise-upsell")).toBeVisible();
      expect(screen.queryByTestId("braids-turned-off")).toBeNull();
    });
  });
});
