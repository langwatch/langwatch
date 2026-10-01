// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The governance overview's hero and the two lists under it, as an admin and a delegated viewer meet them.
 * Real page over the fake host; the API and the shader are the only boundaries mocked.
 * @see specs/ai-governance/dashboard/governance-overview-hero.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INSIGHTS_HREF,
  SAMPLE_ACTIVITY,
  SAMPLE_INSIGHTS,
  SEVERITIES,
} from "../../../../features/overview/model/sample-home-rows.ts";
import {
  ADD_AGENT_HREF,
  ADD_DEPARTMENT_HREF,
  ADD_TOOL_HREF,
  addSourceHref,
  INVENTORY_SOURCES_HREF,
} from "../../../../features/overview/ui/sections/governance-hero.tsx";
import { FakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { SAMPLE_CHOICE_KEY } from "../../../elements/governance-sample-mode.ts";

const harness = vi.hoisted(() => ({ requested: [] as string[] }));

vi.mock("@paper-design/shaders-react", () => ({ MeshGradient: () => null }));
vi.mock("../../../../features/overview/ui/sections/quarantine-fill-panel.tsx", () => ({
  QuarantineFillAlert: () => null,
}));
vi.mock("../../../../behavior/governance-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              if (options?.enabled !== false) harness.requested.push(path.join("."));
              return {
                data: undefined,
                isLoading: false,
                isFetching: false,
                isError: false,
                error: null,
                refetch: vi.fn(),
              };
            };
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
          }
          if (["invalidate", "setData", "fetch", "cancel", "prefetch"].includes(property)) {
            return vi.fn();
          }
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  return { api, governanceApi: api };
});

import GovernanceOverviewPage from "../governance-overview.screen.tsx";

const SECTION_FLAG = "release_ui_ai_governance_enabled";
const BILLED_FLAG = "release_ui_governance_billed_cost_enabled";
const MANAGER = ["governance:view", "activityMonitor:view", "ingestionSources:manage"];
const VIEWER = ["governance:view", "activityMonitor:view"];

function renderOverview({
  permissions = VIEWER,
  enabledFlags = [SECTION_FLAG, BILLED_FLAG],
  plan,
}: {
  permissions?: string[];
  enabledFlags?: string[];
  plan?: { isEnterprise: boolean; isLoading: boolean };
} = {}) {
  const host = FakeGovernanceHost.create({ permissions, enabledFlags, ...(plan ? { plan } : {}) });
  renderWithGovernanceHost(<GovernanceOverviewPage />, { host });
  return host;
}

beforeEach(() => {
  window.sessionStorage.clear();
  harness.requested = [];
});
afterEach(() => cleanup());

const openAddSource = async () =>
  userEvent.click(screen.getByRole("button", { name: /Add source/ }));

describe("given an admin who may manage sources", () => {
  /** @scenario "The hero leads with adding a source" */
  it("offers Add source above the shortcuts and opens a menu rather than firing at once", async () => {
    renderOverview({ permissions: MANAGER });
    expect(screen.queryByRole("menu")).toBeNull();

    await openAddSource();

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  /** @scenario "The source menu names the three vendors an admin arrives with" */
  it("offers Anthropic, OpenAI and Microsoft Copilot in that order and picking one opens that vendor's add flow", async () => {
    const host = renderOverview({ permissions: MANAGER });

    await openAddSource();
    const vendors = (await screen.findAllByRole("menuitem")).slice(0, 3);

    expect(vendors.map((item) => item.textContent)).toEqual([
      "Anthropic",
      "OpenAI",
      "Microsoft Copilot",
    ]);
    await userEvent.click(vendors[1] ?? document.body);
    expect(host.recording.navigations).toEqual([addSourceHref("openai_admin")]);
  });

  /** @scenario "The hero offers four ways in, three to add and one to configure" */
  it("offers three add chips in order and keeps Configure sources as the last row of the menu", async () => {
    renderOverview({ permissions: MANAGER });

    const chips = ["Add department", "Add agent", "Add tool"].map((name) =>
      screen.getByRole("link", { name }),
    );
    const order = (a: HTMLElement, b: HTMLElement) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(chips[0] ?? document.body, chips[1] ?? document.body)).toBeTruthy();
    expect(order(chips[1] ?? document.body, chips[2] ?? document.body)).toBeTruthy();

    await openAddSource();
    const rows = await screen.findAllByRole("menuitem");
    expect(rows.at(-1)).toHaveTextContent("Configure sources");
  });

  /** @scenario "A shortcut leads through to every source the product can pull from" */
  it("leads Configure sources to the sources tab of the inventory", async () => {
    renderOverview({ permissions: MANAGER });

    await openAddSource();

    expect(await screen.findByRole("menuitem", { name: "Configure sources" })).toHaveAttribute(
      "href",
      INVENTORY_SOURCES_HREF,
    );
  });
});

describe("given a delegated viewer who may not manage sources", () => {
  /** @scenario "Adding a source is offered only to whoever may add one" */
  it("offers no Add source control and no Configure sources row, and the three shortcuts just the same", () => {
    renderOverview();

    expect(screen.queryByRole("button", { name: /Add source/ })).toBeNull();
    expect(screen.queryByText("Configure sources")).toBeNull();
    for (const name of ["Add department", "Add agent", "Add tool"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });
});

describe("given the overview renders", () => {
  /** @scenario "Each add shortcut opens the flow that adds the thing it names" */
  it("leads each add shortcut to the page and the add flow it names", () => {
    renderOverview();

    expect(screen.getByRole("link", { name: "Add department" })).toHaveAttribute(
      "href",
      ADD_DEPARTMENT_HREF,
    );
    expect(screen.getByRole("link", { name: "Add agent" })).toHaveAttribute("href", ADD_AGENT_HREF);
    expect(screen.getByRole("link", { name: "Add tool" })).toHaveAttribute("href", ADD_TOOL_HREF);
    for (const href of [ADD_DEPARTMENT_HREF, ADD_AGENT_HREF, ADD_TOOL_HREF]) {
      expect(new URLSearchParams(href.split("?")[1]).get("add")).toBe("1");
    }
  });

  /** @scenario "Insights and recent activity wait under the hero" */
  it("shows the two sections with their empty lines while samples are off", () => {
    window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
    renderOverview();

    expect(screen.getByText("Insights")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing to report yet. Insights appear here once sources are pulling."),
    ).toBeInTheDocument();
    expect(screen.getByText("Your recent screens will show up here.")).toBeInTheDocument();
    const hero = screen.getByRole("heading", { level: 2 });
    const order = hero.compareDocumentPosition(screen.getByText("Insights"));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /** @scenario "The overview renders no error alert and issues no spend read" */
  it("shows no alert and reads only the source list when the plan lacks the activity monitor", () => {
    renderOverview({ plan: { isEnterprise: false, isLoading: false } });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(harness.requested.filter((path) => path !== "ingestionSources.list")).toEqual([]);
  });
});

describe("given the sample data is enabled", () => {
  beforeEach(() => window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true"));

  /** @scenario "The two lists fill when samples are enabled" */
  it("fills both lists with sample rows and marks each list sample beside its name", () => {
    renderOverview();

    expect(screen.getByText(SAMPLE_INSIGHTS[0]?.headline ?? "")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to report yet/)).toBeNull();
    expect(screen.getAllByText("sample")).toHaveLength(2);
  });

  /** @scenario "An insight row reads as a severity, a headline and a date" */
  it("leads each insight with its severity, then the headline, then the date", () => {
    renderOverview();

    for (const insight of SAMPLE_INSIGHTS) {
      const row = screen.getByText(insight.headline).parentElement;
      expect(row).toHaveTextContent(
        `${SEVERITIES[insight.severity].label}${insight.headline}${insight.date}`,
      );
    }
    expect(new Set(SAMPLE_INSIGHTS.map((insight) => insight.severity))).toEqual(
      new Set(["warning", "look", "good"]),
    );
  });

  /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
  it("leads each row to its screen with the name and the kind, and drops rows for screens not offered", () => {
    renderOverview({ enabledFlags: [SECTION_FLAG] });

    const offered = SAMPLE_ACTIVITY.filter((row) => !row.ridesInsightsFlag);
    for (const row of offered) {
      const link = screen.getByText(row.name).closest("a");
      expect(link).toHaveAttribute("href", row.href);
      expect(link).toHaveTextContent(`${row.name}${row.kind}`);
      expect(link?.querySelector("svg")).not.toBeNull();
    }
    for (const row of SAMPLE_ACTIVITY.filter((sample) => sample.ridesInsightsFlag)) {
      expect(screen.queryByText(row.name)).toBeNull();
    }
  });

  /** @scenario "The overview carries the section's sample toggle" */
  it("takes the sample lines off both lists when pressed and records the one shared choice", async () => {
    renderOverview();

    await userEvent.click(screen.getByRole("button", { name: "Hide sample data" }));

    expect(screen.getByText(/Nothing to report yet/)).toBeInTheDocument();
    expect(screen.getByText("Your recent screens will show up here.")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(SAMPLE_CHOICE_KEY)).toBe("false");
  });
});

describe("given the Insights screen is or is not offered", () => {
  /** @scenario "Setting up insights is offered only where the screen exists" */
  it("draws Set up insights when the billed-cost flag is on and no such button when it is off", () => {
    renderOverview({ enabledFlags: [SECTION_FLAG, BILLED_FLAG] });
    expect(screen.getByRole("link", { name: "Set up insights" })).toHaveAttribute(
      "href",
      INSIGHTS_HREF,
    );
    cleanup();

    renderOverview({ enabledFlags: [SECTION_FLAG] });
    expect(screen.queryByRole("link", { name: "Set up insights" })).toBeNull();
    expect(within(document.body).queryByText("Set up insights")).toBeNull();
  });
});
