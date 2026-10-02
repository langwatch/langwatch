// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Agents page as a reader meets it: what an empty pane says and why, the
 * sample choice, the filter chips, the two layouts and the fleet strip.
 *
 * Only the tRPC client and the drawer opener are doubled; the address is the
 * governance host's, and the filters' own address is a real memory router.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { builtinRolePermissions } from "@langwatch/authz-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_AGENT_ROWS } from "../../../../features/agents/agent-rows.ts";
import {
  fakeGovernanceHost,
  findNativeSelects,
  renderWithGovernanceHost,
} from "../../../../testing.tsx";
import { SAMPLE_CHOICE_KEY } from "../../../../ui/elements/governance-sample-mode.ts";

const harness = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false, error: null as unknown },
  sources: { data: undefined as unknown, isLoading: false },
  openDrawer: vi.fn(),
  requested: 0,
}));

vi.mock("@langwatch/browser-host/drawer", async () => ({
  ...(await vi.importActual("@langwatch/browser-host/drawer")),
  useDrawer: () => ({ openDrawer: harness.openDrawer, closeDrawer: vi.fn(), goBack: vi.fn() }),
}));

vi.mock("../../../../behavior/governance-api.ts", () => {
  const mutation = (options?: { onSuccess?: (result: unknown) => void }) => ({
    mutate: () => options?.onSuccess?.({ requested: harness.requested, sources: [] }),
    isPending: false,
    error: null,
  });
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            const full = path.join(".");
            if (full === "governanceAgents.list") return () => harness.list;
            if (full === "governanceAgents.syncSources") return () => harness.sources;
            return () => ({ data: undefined, isLoading: false, error: null });
          }
          if (property === "useMutation") return mutation;
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  return { api, governanceApi: api };
});

import AgentsPage from "../agents.tsx";

const ADMIN = [...builtinRolePermissions("org-admin"), ...builtinRolePermissions("admin")];
const VIEWER_ONLY = ["governance:view"];

const source = (
  overrides: { name?: string; lastListing?: unknown } = {},
): Record<string, unknown> => ({
  id: `src-${overrides.name ?? "databricks"}`,
  name: "Databricks",
  sourceType: "databricks",
  lastListing: null,
  ...overrides,
});
const refused = (cause: "access" | "unreachable" | "incomplete") => ({
  outcome: "refused",
  cause,
});
const LISTED = { outcome: "listed" };

function LocationProbe() {
  return <output data-testid="address">{useLocation().search}</output>;
}

function renderPage({
  permissions = ADMIN,
  at = "/governance/agents",
  query = {},
}: {
  permissions?: readonly string[];
  at?: string;
  query?: Record<string, string>;
} = {}) {
  const host = fakeGovernanceHost({ permissions, query });
  const view = renderWithGovernanceHost(
    <MemoryRouter initialEntries={[at]}>
      <AgentsPage />
      <LocationProbe />
    </MemoryRouter>,
    { host },
  );
  return { host, ...view };
}

const withSampleOn = () => window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
const withNoAgents = () => {
  harness.list = { data: [], isLoading: false, error: null };
};
const chip = (label: string) => {
  const found = screen.getAllByRole("button").find((b) => b.textContent?.startsWith(label));
  if (!found) throw new Error(`no ${label} chip`);
  return found;
};
const pick = async ({ chipLabel, option }: { chipLabel: string; option: string }) => {
  await userEvent.click(chip(chipLabel));
  await userEvent.click(await screen.findByRole("menuitem", { name: option }));
};
const byName = (a: string, b: string) => a.localeCompare(b);
const rowNames = () =>
  screen
    .queryAllByTestId("governance-agent-row")
    .map((row) => row.getAttribute("data-agent") ?? "");
const emptyText = (testId: string) => screen.getByTestId(testId).textContent ?? "";

beforeEach(() => {
  window.sessionStorage.clear();
  harness.list = { data: undefined, isLoading: false, error: null };
  harness.sources = { data: undefined, isLoading: false };
  harness.openDrawer.mockReset();
  harness.requested = 0;
});

afterEach(() => cleanup());

describe("the Agents page reading the organization's agents", () => {
  describe("given sample data is off and the organization has no agents", () => {
    /** @scenario "An organization with no agents stays empty rather than filling with samples" */
    it("lists nothing and renders its own empty state", () => {
      withNoAgents();
      renderPage();

      expect(rowNames()).toEqual([]);
      expect(emptyText("agents-empty")).toContain("No agents registered yet");
    });
  });

  describe("given the agents read has not answered", () => {
    /** @scenario "A read still in flight shows neither agents nor an empty state" */
    it("shows that it is loading and does not claim nobody has registered", () => {
      harness.list = { data: undefined, isLoading: true, error: null };
      renderPage();

      expect(screen.getByLabelText("Loading agents")).toBeInTheDocument();
      expect(screen.queryByText("No agents registered yet")).toBeNull();
    });
  });

  describe("given the agents read fails", () => {
    /** @scenario "A failed agents read says so instead of claiming there are no agents" */
    it("shows an alert saying the agents could not be loaded", () => {
      harness.list = { data: undefined, isLoading: false, error: new Error("read failed") };
      renderPage();

      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load agents");
    });
  });
});

describe("the sample choice on the Agents page", () => {
  describe("given the reader turned samples on and no read exists", () => {
    beforeEach(withSampleOn);

    /** @scenario "The empty agents page shows samples when requested" */
    it("lists the sample agents, each marked, under the banner", () => {
      renderPage();

      const rows = screen.getAllByTestId("governance-agent-row");
      expect(rows).toHaveLength(SAMPLE_AGENT_ROWS.length);
      for (const row of rows) expect(within(row).getByText("sample")).toBeInTheDocument();
      expect(screen.getByText(/nothing here is real/i)).toBeInTheDocument();
    });

    /** @scenario "Turning sample data off leaves the honest empty pane" */
    it("leaves the headed empty state with a way to register, and no banner", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: "Hide sample data" }));

      expect(rowNames()).toEqual([]);
      const empty = screen.getByTestId("agents-empty");
      expect(empty).toHaveTextContent("No agents registered yet");
      expect(within(empty).getByRole("button", { name: "Register agent" })).toBeInTheDocument();
      expect(screen.queryByText(/nothing here is real/i)).toBeNull();
    });
  });
});

describe("the empty pane of the Agents page", () => {
  describe("given providers that can list agents and none has been asked", () => {
    /** @scenario "An empty table with a provider connected says which and offers the ask" */
    it("names the providers, says nothing was listed, and offers to ask", () => {
      withNoAgents();
      harness.sources = { data: [source()], isLoading: false };
      renderPage();

      const text = emptyText("agents-empty-unlisted");
      expect(text).toContain("Databricks");
      expect(text).toContain("no agent has been listed from it yet");
      expect(text).not.toContain("registered yet");
      expect(
        within(screen.getByTestId("agents-empty-unlisted")).getByRole("button", {
          name: "Sync agents",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("given a provider that refused to list its agents", () => {
    beforeEach(() => {
      withNoAgents();
      harness.sources = { data: [source({ lastListing: refused("access") })], isLoading: false };
    });

    /** @scenario "A provider that refused is never reported as an empty organization" */
    it("says the provider refused, in words the answered-none pane does not use", () => {
      renderPage();
      const refusal = emptyText("agents-empty-refused");
      expect(refusal).toContain("refused to answer");
      expect(refusal).not.toMatch(/no agents/i);
      cleanup();

      harness.sources = { data: [source({ lastListing: LISTED })], isLoading: false };
      renderPage();

      expect(emptyText("agents-empty-listed")).not.toBe(refusal);
    });

    /** @scenario "A refusal never shows the HTTP status behind it" */
    it("shows no status code and no provider error text", () => {
      renderPage();

      const text = emptyText("agents-empty-refused");
      expect(text).not.toMatch(/\b[45]\d\d\b/);
      expect(text).not.toMatch(/http|unauthori[sz]ed|forbidden/i);
    });
  });

  describe("given one provider refused and another answered", () => {
    /** @scenario "A refusal names which providers refused and what to do about it" */
    it("names only the refusing provider and tells the administrator to check it", () => {
      withNoAgents();
      harness.sources = {
        data: [
          source({ lastListing: refused("access") }),
          source({ name: "Copilot Studio", lastListing: LISTED }),
        ],
        isLoading: false,
      };
      renderPage();

      const text = emptyText("agents-empty-refused");
      expect(text).toContain("Databricks");
      expect(text).not.toContain("Copilot Studio");
      expect(text).toContain("cannot say what it holds");
      expect(text).toContain("Check that connection's credentials");
    });
  });

  describe("given a provider refused for a named cause", () => {
    const ADVICE = {
      access: /check that connection's credentials/i,
      unreachable: /ask again in a moment/i,
      incomplete: /asking again will not help/i,
    };

    /** @scenario "Every reason a provider refuses is named on the agents page" */
    it.each(["access", "unreachable", "incomplete"] as const)(
      "gives the advice for %s and no other cause's",
      (cause) => {
        withNoAgents();
        harness.sources = { data: [source({ lastListing: refused(cause) })], isLoading: false };
        renderPage();

        const text = emptyText("agents-empty-refused");
        expect(text).toMatch(ADVICE[cause]);
        const others = (["access", "unreachable", "incomplete"] as const).filter(
          (other) => other !== cause,
        );
        for (const other of others) expect(text).not.toMatch(ADVICE[other]);
      },
    );
  });

  describe("given two providers refused for different reasons", () => {
    /** @scenario "Two refusing providers show the advice that matters most" */
    it("names both and gives the advice for the cause that needs acting on", () => {
      withNoAgents();
      harness.sources = {
        data: [
          source({ lastListing: refused("unreachable") }),
          source({ name: "Copilot Studio", lastListing: refused("access") }),
        ],
        isLoading: false,
      };
      renderPage();

      const text = emptyText("agents-empty-refused");
      expect(text).toContain("Databricks");
      expect(text).toContain("Copilot Studio");
      expect(text).toMatch(/check those connections' credentials/i);
      expect(text).not.toMatch(/ask again in a moment/i);
    });
  });

  describe("given a reader without the governance manage grant", () => {
    /** @scenario "A reader who cannot sync is told who can fix a refusal" */
    it("says an administrator must check the connection and does not tell them to ask again", () => {
      withNoAgents();
      harness.sources = { data: [source({ lastListing: refused("access") })], isLoading: false };
      renderPage({ permissions: VIEWER_ONLY });

      const text = emptyText("agents-empty-refused");
      expect(text).toContain("An administrator needs to check that connection's credentials");
      expect(text).not.toMatch(/then ask again/i);
    });
  });

  describe("given every connected provider was asked and holds no agents", () => {
    /** @scenario "Every provider answering with none is the one time the page says so" */
    it("says they hold none and offers registering from code", () => {
      withNoAgents();
      harness.sources = {
        data: [
          source({ lastListing: LISTED }),
          source({ name: "Copilot Studio", lastListing: LISTED }),
        ],
        isLoading: false,
      };
      renderPage();

      const pane = screen.getByTestId("agents-empty-listed");
      expect(pane).toHaveTextContent("hold no agents");
      expect(pane).toHaveTextContent("registers itself from the process that runs it");
      expect(within(pane).getByRole("button", { name: "Register agent" })).toBeInTheDocument();
    });
  });

  describe("given one provider answered with none and another was never asked", () => {
    /** @scenario "A provider answered and another unasked claims nothing about the tenant" */
    it("says nothing has been listed yet and does not claim there are no agents", () => {
      withNoAgents();
      harness.sources = {
        data: [source({ lastListing: LISTED }), source({ name: "Copilot Studio" })],
        isLoading: false,
      };
      renderPage();

      const text = emptyText("agents-empty-unlisted");
      expect(text).toContain("no agent has been listed from them yet");
      expect(text).not.toMatch(/holds? no agents/);
    });
  });

  describe("given sample data is off and nothing is registered", () => {
    /** @scenario "Every empty state on the page carries a way out" */
    it("renders a glyph, a headline, a sentence and a button", () => {
      withNoAgents();
      renderPage();

      const pane = screen.getByTestId("agents-empty");
      expect(pane.querySelector("svg")).not.toBeNull();
      expect(pane).toHaveTextContent("No agents registered yet");
      expect(pane).toHaveTextContent("An agent registers itself from the process that runs it");
      expect(within(pane).getByRole("button", { name: "Register agent" })).toBeInTheDocument();
    });

    /** @scenario "With nothing to summarize the strip is absent rather than showing zeroes" */
    it("draws no summary strip and says no agents are registered yet", () => {
      withNoAgents();
      renderPage();

      expect(screen.queryByTestId("agents-summary-strip")).toBeNull();
      expect(screen.getByTestId("agents-empty")).toHaveTextContent("No agents registered yet");
    });

    /** @scenario "The filter row sits outside the content it narrows" */
    it("offers no filter chips at all with nothing registered", () => {
      withNoAgents();
      renderPage();

      const chips = screen
        .queryAllByRole("button")
        .filter((b) => /^(Source|Ownership|Sort)/.test(b.textContent ?? ""));
      expect(chips).toEqual([]);
    });
  });
});

describe("the sync control of the Agents page", () => {
  describe("given a connected provider that is not scheduled to be asked", () => {
    /** @scenario "Sync with nothing scheduled says so and stays pressable" */
    it("says none is scheduled, never that zero were asked, and stays pressable", async () => {
      withNoAgents();
      harness.sources = { data: [source()], isLoading: false };
      const { host } = renderPage();
      const control = screen.getByTestId("governance-sync-button");

      await userEvent.click(control);

      const [notice] = host.recording.successes;
      expect(notice?.description).toContain("No connected provider is scheduled to be asked");
      expect(notice?.description).not.toMatch(/asked 0/i);
      expect(control).toBeEnabled();
      expect(control).toHaveAttribute("data-state", "ready");
    });
  });
});

describe("the header of the Agents page", () => {
  beforeEach(withSampleOn);

  /** @scenario "The sample toggle and the register action sit in the page header" */
  it("holds the sample toggle and Register agent beside the title and nowhere else", () => {
    renderPage();

    const toggle = screen.getByRole("button", { name: /sample data/i });
    const register = screen.getByRole("button", { name: "Register agent" });
    let header: HTMLElement | null = screen.getAllByRole("heading", { name: "Agents" })[0] ?? null;
    while (header && !header.contains(toggle)) header = header.parentElement;
    expect(header?.contains(register)).toBe(true);
    expect(header?.querySelector('[data-testid="governance-agents-table"]')).toBeNull();
    expect(screen.getAllByRole("button", { name: "Register agent" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /sample data/i })).toHaveLength(1);
  });
});

describe("the register-agent deep link", () => {
  describe("given the address carries add=1 and no drawer", () => {
    it("opens the register drawer once", () => {
      withNoAgents();
      renderPage({ query: { add: "1" } });

      expect(harness.openDrawer).toHaveBeenCalledWith("addAgent");
    });
  });

  describe("given the address carries add=1 and the open register drawer", () => {
    /** @scenario "The request to register an agent leaves the address once the drawer has it" */
    it("drops add from the address, keeps the drawer named and asks for it no more", () => {
      withNoAgents();
      const { host } = renderPage({ query: { add: "1", "drawer.open": "addAgent" } });

      const written = host.recording.queries.at(-1)?.next ?? {};
      expect(written["add"]).toBeUndefined();
      expect(written["drawer.open"]).toBe("addAgent");
      expect(harness.openDrawer).not.toHaveBeenCalled();
    });
  });
});

describe("the Agents page with the sample agents on screen", () => {
  beforeEach(withSampleOn);

  describe("when the page renders", () => {
    /** @scenario "Source and ownership are filter chips beside the sort chip" */
    it("offers Source, Ownership and Sort chips and no native select", () => {
      const { container } = renderPage();

      expect(chip("Source")).toBeInTheDocument();
      expect(chip("Ownership")).toBeInTheDocument();
      expect(chip("Sort")).toBeInTheDocument();
      expect(findNativeSelects(container)).toEqual([]);
    });

    /** @scenario "The filter row sits outside the content it narrows" */
    it("keeps every filter chip outside the region holding the agents", () => {
      renderPage();

      const region = screen.getByTestId("governance-agents-table");
      for (const label of ["Source", "Ownership", "Sort"]) {
        expect(region.contains(chip(label))).toBe(false);
      }
    });

    /** @scenario "The agents page opens on the list rather than the cards" */
    it("lists one agent per row with List chosen in the layout switch", () => {
      renderPage();

      expect(screen.getAllByTestId("governance-agent-row")).toHaveLength(SAMPLE_AGENT_ROWS.length);
      expect(screen.queryByTestId("governance-agent-card")).toBeNull();
      expect(screen.getByRole("radio", { name: /List/ })).toBeChecked();
      expect(screen.getByRole("radio", { name: /Grid/ })).not.toBeChecked();
    });

    /** @scenario "The list carries every attribute an agent row holds" */
    it("has a column for each attribute and abbreviates no header", () => {
      renderPage();

      const headers = within(screen.getByTestId("governance-agents-table"))
        .getAllByRole("columnheader")
        .map((h) => h.textContent);
      expect(headers).toEqual([
        "Agent",
        "Environment",
        "Owner",
        "Source",
        "Models",
        "Health",
        "Cost · 30 days",
        "Requests · 30 days",
        "Last active",
        "Registered",
      ]);
    });

    /** @scenario "A value the list does not have reads as a dash, never a zero" */
    it("draws a never-called agent's figures as explained dashes on a named row", () => {
      renderPage();

      const row = screen
        .getAllByTestId("governance-agent-row")
        .find((r) => r.getAttribute("data-agent") === "contract-review");
      if (!row) throw new Error("no contract-review row");
      expect(within(row).getByText("contract-review")).toBeInTheDocument();
      expect(within(row).getByText("development")).toBeInTheDocument();
      const dashes = within(row).getAllByText("No data");
      expect(dashes.length).toBeGreaterThanOrEqual(4);
      for (const dash of dashes) expect(dash.getAttribute("aria-label")).toMatch(/not measured/);
      expect(row.textContent).not.toContain("$0");
    });

    /** @scenario "The fleet summary strip sits above the filter chips and the agents" */
    it("shows four headed cards below the banner and above every chip", () => {
      renderPage();

      const strip = screen.getByTestId("agents-summary-strip");
      for (const eyebrow of ["Fleet", "Health", "Ownership", "Top spenders"]) {
        expect(within(strip).getByText(eyebrow)).toBeInTheDocument();
      }
      const after = (a: Node, b: Node) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(after(screen.getByText(/nothing here is real/i), strip)).toBe(true);
      expect(after(strip, chip("Source"))).toBe(true);
      expect(after(strip, screen.getByTestId("governance-agents-table"))).toBe(true);
    });
  });

  describe("when the reader chooses Grid", () => {
    /** @scenario "Choosing Grid draws the cards and writes the choice to the address" */
    it("renders the cards and writes view=grid, and List takes it back out", async () => {
      const { host } = renderPage();

      await userEvent.click(screen.getByRole("radio", { name: /Grid/ }));

      expect(screen.getAllByTestId("governance-agent-card")).toHaveLength(SAMPLE_AGENT_ROWS.length);
      expect(screen.queryByTestId("governance-agents-table")).toBeNull();
      expect(host.recording.queries.at(-1)?.next["view"]).toBe("grid");

      await userEvent.click(screen.getByRole("radio", { name: /List/ }));

      expect(screen.getByTestId("governance-agents-table")).toBeInTheDocument();
      expect(host.recording.queries.at(-1)?.next["view"]).toBeUndefined();
    });
  });

  describe("given the grid layout", () => {
    beforeEach(() => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
    });

    /** @scenario "A card names the agent, where it runs, who owns it and what it costs" */
    it("carries name, environment, owner, models, source, spend, requests and last active", () => {
      renderPage({ query: { view: "grid" } });

      const card = screen
        .getAllByTestId("governance-agent-card")
        .find((c) => c.textContent?.includes("support-copilot"));
      if (!card) throw new Error("no support-copilot card");
      for (const text of [
        "production",
        "Customer Support",
        "gpt-5-mini",
        "claude-sonnet-5",
        "Custom",
        "$4,182.40",
        "128,400",
        "4 minutes ago",
      ]) {
        expect(card).toHaveTextContent(text);
      }
    });

    /** @scenario "A figure the platform does not have reads as a dash, never a zero" */
    it("draws a never-called agent's spend and requests as explained dashes", () => {
      renderPage({ query: { view: "grid" } });

      const card = screen
        .getAllByTestId("governance-agent-card")
        .find((c) => c.textContent?.includes("contract-review"));
      if (!card) throw new Error("no contract-review card");
      const dashes = within(card).getAllByText("No data");
      expect(dashes.length).toBeGreaterThanOrEqual(2);
      for (const dash of dashes) expect(dash.getAttribute("aria-label")).toMatch(/not measured/);
      expect(card.textContent).not.toContain("$0");
    });
  });

  describe("when the reader filters and sorts", () => {
    /** @scenario "Filtering by source leaves only that source's agents" */
    it("keeps only the chosen source's agents", async () => {
      renderPage();

      await pick({ chipLabel: "Source", option: "Databricks" });

      expect(rowNames().toSorted(byName)).toEqual([
        "genie-revenue-analyst",
        "genie-supply-planner",
      ]);
    });

    /** @scenario "Ownership filters down to the agents nobody has claimed" */
    it("keeps only the unowned agents, each badged Unclaimed", async () => {
      renderPage();

      await pick({ chipLabel: "Ownership", option: "Unclaimed only" });

      const unowned = SAMPLE_AGENT_ROWS.filter((r) => r.owner === null).map((r) => r.name);
      expect(rowNames().toSorted(byName)).toEqual(unowned.toSorted(byName));
      for (const row of screen.getAllByTestId("governance-agent-row")) {
        expect(within(row).getByText("Unclaimed")).toBeInTheDocument();
      }
    });

    /** @scenario "A filter choice is part of the address" */
    it("writes each choice to the address and applies all three when opened again", async () => {
      renderPage();

      await pick({ chipLabel: "Source", option: "Custom" });
      await pick({ chipLabel: "Ownership", option: "Unclaimed only" });
      await pick({ chipLabel: "Sort", option: "Requests" });

      const written = new URLSearchParams(screen.getByTestId("address").textContent ?? "");
      expect(Object.fromEntries(written)).toEqual({
        source: "custom",
        ownership: "unclaimed",
        sort: "requests",
      });
      cleanup();

      renderPage({ at: "/governance/agents?source=custom&ownership=unclaimed&sort=requests" });

      expect(rowNames()).toEqual(["churn-predictor", "contract-review"]);
    });

    /** @scenario "Sorting reorders the agents" */
    it("orders the agents by request counts when sorted by requests", async () => {
      renderPage();

      await pick({ chipLabel: "Sort", option: "Requests" });

      const byRequests = SAMPLE_AGENT_ROWS.filter((r) => r.requests30d !== null)
        .toSorted((a, b) => (b.requests30d ?? 0) - (a.requests30d ?? 0))
        .map((r) => r.name);
      expect(rowNames().slice(0, byRequests.length)).toEqual(byRequests);
    });

    /** @scenario "Filtering everything out offers the filters back, not a registration" */
    it("says no agent matches, offers clearing the filters, and clearing brings the agents back", async () => {
      renderPage();

      await pick({ chipLabel: "Source", option: "Copilot Studio" });
      await pick({ chipLabel: "Ownership", option: "Unclaimed only" });

      const pane = screen.getByTestId("agents-no-match");
      expect(pane).toHaveTextContent("No agent matches these filters");
      expect(within(pane).queryByRole("button", { name: "Register agent" })).toBeNull();

      await userEvent.click(within(pane).getByRole("button", { name: "Clear filters" }));

      expect(rowNames()).toHaveLength(SAMPLE_AGENT_ROWS.length);
    });
  });
});

describe("given an agent that ran and cost nothing", () => {
  /** @scenario "A measured zero remains a number" */
  it("keeps its zero dollars and zero requests visible as zero, not as a dash", () => {
    const [template] = SAMPLE_AGENT_ROWS;
    harness.list = {
      data: [{ ...template, id: "zero", name: "quiet-agent", costUsd30d: 0, requests30d: 0 }],
      isLoading: false,
      error: null,
    };
    renderPage();

    const row = screen.getByTestId("governance-agent-row");
    expect(within(row).getByText("$0.00")).toBeInTheDocument();
    expect(within(row).getByText("0")).toBeInTheDocument();
    expect(within(row).queryByLabelText(/not measured/i)).toBeNull();
  });
});
