/**
 * @vitest-environment jsdom
 *
 * The governance overview, driven through the real page: a real permission
 * set goes into `useOrganizationTeamProject`, and the real page decides which
 * ways in it draws, where each one goes, and what it reads.
 *
 * Only the boundaries are mocked - the layout chrome, the feature flag, the
 * plan, the router, the inline palette, and the tRPC client. The tRPC double
 * records every read the page issues, which is what lets the last test say
 * the page reads nothing rather than only that it shows no error.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** The grants the viewer under test holds. */
  permissions: [] as string[],
  /** Whether the billed-cost flag, which offers the Insights screen, is on. */
  flagEnabled: true,
  /** Per-procedure answers, keyed by dotted path. */
  data: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
  push: vi.fn(),
  placeholder: "",
}));

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("~/server/api/rbac")>(
      "~/server/api/rbac",
    );
  const holds = (permission: string) =>
    rbac.hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

// Answered per flag, not once for all of them: the page itself rides the
// governance flag, so a blanket `false` would close the whole screen and every
// assertion about what it does not draw would pass for the wrong reason.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled:
      flag === "release_ui_governance_billed_cost_enabled"
        ? harness.flagEnabled
        : true,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/governance/QuarantineFillAlert", () => ({
  QuarantineFillAlert: () => null,
}));

vi.mock("~/components/home/WelcomeHeader", () => ({
  WelcomeHeader: () => <h1>Good morning</h1>,
}));

vi.mock("~/features/command-bar/CommandPalette", () => ({
  CommandPalette: ({ placeholder }: { placeholder: string }) => {
    harness.placeholder = placeholder;
    return <input placeholder={placeholder} />;
  },
}));

vi.mock("~/features/command-bar/CommandBarContext", () => ({
  useCommandBar: () => ({ registerInlinePalette: () => () => undefined }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance",
    push: harness.push,
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const queryResult = (path: string) => {
    const error = harness.errors[path] ?? null;
    return {
      data: harness.data[path],
      isLoading: false,
      isFetching: false,
      isError: error !== null,
      error,
      refetch: vi.fn(),
    };
  };
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              if (options?.enabled !== false)
                harness.requested.push(path.join("."));
              return queryResult(path.join("."));
            };
          }
          if (property === "useMutation") return mutationResult;
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

// The lit ground behind the hero runs a WebGL shader, which jsdom has no
// canvas for. The ground's own box — the thing the page is responsible for —
// is this component's wrapper, not the shader inside it.
vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => <div data-testid="mesh-gradient" />,
}));

import { findNativeSelects } from "~/components/governance/filters";
import {
  readSampleChoice,
  writeSampleChoice,
} from "~/components/governance/sample";

import GovernanceOverviewPage from "../index";

/** The reads the overview's viewer holds, and nothing that manages. */
const VIEWER = ["organization:view", "governance:view", "activityMonitor:view"];

/** How the tRPC client hands over a handled error the router threw. */
const enterpriseLocked = () => ({
  message: "enterprise_plan_required",
  data: {
    error: {
      code: "enterprise_plan_required",
      httpStatus: 402,
      fault: "customer",
      meta: { feature: "ANOMALY_RULES" },
    },
  },
});

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/governance"]}>
        <GovernanceOverviewPage />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

/** One of the invented insights, used to find its own row. */
const A_SAMPLE_INSIGHT =
  "Three registered agents have run without a named owner since May.";

/**
 * The hero's shortcut row, by label, in the order it is drawn. All three add
 * something; the fourth way in configures, and lives at the foot of the
 * source menu rather than in this row.
 */
const WAY_IN_LABELS = ["Add department", "Add agent", "Add tool"] as const;

/** The same three, read as the adds they are. */
const ADD_LABELS = WAY_IN_LABELS;

const wayInLinks = () =>
  screen
    .getAllByRole("link")
    .filter((link) =>
      (WAY_IN_LABELS as readonly string[]).includes(link.textContent ?? ""),
    );

const wayInLabels = () => wayInLinks().map((link) => link.textContent ?? "");

const wayInHrefs = () =>
  wayInLinks().map((link) => link.getAttribute("href") ?? "");

/**
 * The package root. `process.cwd()` rather than the `import.meta.url` walk the
 * mark-colour scan uses: that scan runs in the node environment, and under
 * jsdom `import.meta.url` is an http URL that `fileURLToPath` refuses.
 */
const PACKAGE_ROOT = process.cwd();

/**
 * The tab names a governance page honours, read out of the page's own
 * `X_TABS = [...] as const` tuple — the single list its `isXTab` guard tests
 * against, so what this returns is what that page will actually accept.
 *
 * `null` for a page carrying no such tuple. That is a page with no tab bar,
 * not a page this failed to read, and the caller holds it to a stricter rule
 * than a page with tabs, so the two cases have to be told apart.
 *
 * Read from source rather than imported because these tuples are private to
 * their pages, and exporting three of them so a chip test can see them would
 * widen three modules' surface to serve one assertion.
 */
async function tabsOfPage(path: string): Promise<string[] | null> {
  const name = path.replace("/governance/", "");
  const candidates = [
    `src/pages/governance/${name}.tsx`,
    `ee/governance/dashboard/pages/${name}.tsx`,
  ];
  const found = candidates
    .map((candidate) => join(PACKAGE_ROOT, candidate))
    .find((candidate) => existsSync(candidate));
  // Thrown rather than returned empty. An unresolvable page would otherwise
  // look like a page with no tabs, and the caller's `toContain` would fail
  // naming the tab instead of naming the page it could not find. Thrown
  // rather than asserted because an `expect` out here is counted against
  // whichever test happens to be running.
  if (found === undefined) throw new Error(`no page source for ${path}`);

  const source = await readFile(found, "utf8");
  const tuple = /const \w*TABS = \[([^\]]*)\] as const;/.exec(source);
  // Returned rather than thrown: a page may legitimately have no tabs, and a
  // throw here would make dropping a page's tab bar look like a fault in this
  // hero. What the absence costs is charged by the caller instead.
  if (tuple?.[1] === undefined) return null;

  return [...tuple[1].matchAll(/"([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

/**
 * The measure the project home sets its own ask field to, read out of that
 * hero's source.
 *
 * Read rather than imported because the constant is private to that module,
 * and the governance hero restates the value rather than importing the hero
 * behind it. Restating it is what this reads for: if either side moves, the
 * two fields stop matching and the reader meets a field that resizes as they
 * cross between the two screens.
 */
async function projectHomeAskMeasure(): Promise<string> {
  const path = join(PACKAGE_ROOT, "src/components/home/LangyHomeHero.tsx");
  const source = await readFile(path, "utf8");
  const measure = /const ASK_MEASURE = "([^"]+)";/.exec(source);
  // Thrown rather than asserted: an `expect` out here is counted against
  // whichever test happens to be running, and a missing constant is a fact
  // about that file rather than a failure of this page.
  if (measure?.[1] === undefined)
    throw new Error(`no \`const ASK_MEASURE = "..."\` in ${path}`);
  return measure[1];
}

/**
 * The width the nearest ancestor bounds `node` to, as the browser computed
 * it. Walked upwards because the measure is set on a wrapper several levels
 * above whatever the test found by role, and which level that is belongs to
 * the layout rather than to this assertion.
 */
function boxedAncestorWidth(
  node: HTMLElement,
  property: "maxWidth" | "width",
): string {
  let current: HTMLElement | null = node;
  while (current) {
    const value = getComputedStyle(current)[property];
    if (value && value !== "none" && value !== "auto" && value !== "")
      return value;
    current = current.parentElement;
  }
  throw new Error(`nothing above this element sets a ${property}`);
}

/**
 * Every accent-coloured value this element resolves to, across the properties
 * a filled treatment reaches for.
 *
 * The design tokens do not resolve to a colour under jsdom, which computes
 * them to their own variable names ("var(--chakra-colors-orange-subtle)").
 * That is enough, and it is the right thing to read: the rule is about which
 * TOKEN a control is dressed in, not which pixels a theme happens to give
 * that token, and the token name is what changes when the treatment does.
 */
function accentTokens(node: HTMLElement): string[] {
  const style = getComputedStyle(node);
  return (
    [
      style.background,
      style.backgroundColor,
      style.borderColor,
      style.color,
      style.boxShadow,
    ] as const
  ).filter((value) => value.includes("orange"));
}

/** The pill, found by what it does rather than by how it is drawn. */
const sourcePill = () =>
  screen
    .queryAllByRole("button")
    .find((button) => button.getAttribute("aria-haspopup") === "menu");

/** Opens the vendor menu and waits for its items. Real Chakra menu. */
async function openSourceMenu() {
  const user = userEvent.setup();
  const pill = sourcePill();
  // A helper throws where a test asserts. An assertion out here is counted
  // against whichever test happens to be running, and the `as HTMLElement` it
  // needed afterwards hid the missing-pill case from the type checker — which
  // is the case that actually happens, and for a reason worth naming.
  if (!pill) {
    throw new Error(
      "No vendor pill on the page: the menu is only drawn with the ingestionSources:manage grant.",
    );
  }
  await user.click(pill);
  await waitFor(() => expect(screen.getByText("Anthropic")).toBeVisible());
  return user;
}

beforeEach(() => {
  // The sample choice is the section's, kept in session storage, so it would
  // otherwise carry from one test into the next.
  window.sessionStorage.clear();
  harness.permissions = [...VIEWER];
  harness.flagEnabled = true;
  harness.data = {};
  harness.errors = {};
  harness.requested = [];
  harness.placeholder = "";
  harness.push.mockReset();
});

afterEach(() => cleanup());

describe("governance overview", () => {
  describe("when the overview renders", () => {
    /** @scenario "The hero offers four ways in, three to add and one to configure" */
    it("offers three add shortcuts in the row and no configure chip beside them", () => {
      renderPage();

      expect(wayInLabels()).toEqual([...WAY_IN_LABELS]);
      // The fourth way in sits at the foot of the source menu. A chip here as
      // well would be the same destination offered twice, one of them under a
      // pill the reader has to open to find it.
      expect(
        screen.queryByText("Configure sources"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "Each add shortcut opens the flow that adds the thing it names" */
    it("sends each add shortcut to the pane that opens its own add flow", () => {
      renderPage();

      expect(
        screen.getByRole("link", { name: "Add department" }),
      ).toHaveAttribute("href", "/governance/people?tab=departments&add=1");
      // Alone among the three in carrying no tab, because the agents page has
      // no tab bar to name.
      expect(screen.getByRole("link", { name: "Add agent" })).toHaveAttribute(
        "href",
        "/governance/agents?add=1",
      );
      expect(screen.getByRole("link", { name: "Add tool" })).toHaveAttribute(
        "href",
        "/governance/inventory?tab=catalog&add=1",
      );

      // The path alone is what two of these already had while opening
      // nothing: they landed on the right page and left the reader to find
      // the add button, which is the work the shortcut exists to save. So the
      // ask to open is asserted as well as where it is asked of.
      for (const label of ADD_LABELS) {
        const href =
          screen.getByRole("link", { name: label }).getAttribute("href") ?? "";
        const query = new URLSearchParams(href.split("?")[1] ?? "");
        expect(query.get("add")).toBe("1");
      }
    });

    /** @scenario "A shortcut leads through to every source the product can pull from" */
    it("puts configure sources at the foot of the source menu and nowhere else", async () => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
      renderPage();
      await openSourceMenu();

      // Last row of the menu, under the three vendors, still carrying the
      // address the chip carried.
      const configure = screen.getAllByRole("menuitem").at(-1);
      if (!configure) throw new Error("the source menu drew no items");
      expect(configure).toHaveTextContent("Configure sources");
      expect(configure).toHaveAttribute(
        "href",
        "/governance/inventory?tab=sources",
      );

      cleanup();

      // And the cost of the move, asserted rather than left to be found: the
      // row rides the grant that draws the pill, so a viewer who may not add a
      // source now has no way to the sources tab from this page at all.
      harness.permissions = [...VIEWER];
      renderPage();
      expect(sourcePill()).toBeUndefined();
      expect(screen.queryByText("Configure sources")).not.toBeInTheDocument();
    });

    /** @scenario "No shortcut points at a tab the page would not honour" */
    it("names only tabs the destination page actually has", async () => {
      renderPage();

      const destinations = wayInHrefs().map((href) => {
        const [path, query] = href.split("?");
        return {
          path: path ?? "",
          tab: new URLSearchParams(query ?? "").get("tab"),
        };
      });

      // The chips are worth this only because a wrong tab is invisible: the
      // destination degrades an unknown one to its default pane, so the link
      // opens a real screen — just not the one its label promised. Asserting
      // the href alone is what let "Add anomaly rule" keep pointing at a tab
      // the inventory had already dropped.
      expect(destinations.length).toBeGreaterThan(0);
      for (const { path, tab } of destinations) {
        const tabs = await tabsOfPage(path);
        if (tabs === null) {
          // A page with no tab bar is held to more than a page with one: it
          // must not be addressed with a tab at all. A tab a page cannot read
          // is dead weight in the address that outlives whoever put it there,
          // and it reads as deliberate to the next person to open the file.
          // Compared as a pair so a failure names the page rather than only
          // reporting that some string was not null.
          expect({ path, tab }).toEqual({ path, tab: null });
          continue;
        }
        if (tab !== null) expect(tabs).toContain(tab);
      }
    });
  });

  describe("when the viewer can manage ingestion sources", () => {
    /** @scenario "The hero leads with adding a source" */
    it("leads with an Add source control that opens rather than fires", () => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
      renderPage();

      const pill = sourcePill();
      expect(pill).toBeDefined();
      expect(pill).toHaveTextContent("Add source");
      // It opens a menu; nothing is navigated by touching the pill itself.
      expect(harness.push).not.toHaveBeenCalled();
    });

    /** @scenario "The lead action is an outline control rather than a filled one" */
    it("draws the control with no accent anywhere on it, still heavier than the chips", () => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
      renderPage();

      const pill = sourcePill();
      if (!pill) throw new Error("no vendor pill to check the treatment of");

      // Read on the control AND everything inside it: the label, the vendor
      // tiles and the caret are separate elements, and the filled treatment
      // accents the label rather than the button.
      for (const node of [pill, ...pill.querySelectorAll("*")]) {
        expect(accentTokens(node as HTMLElement)).toEqual([]);
      }

      // Heavier than the chips, by surface rather than by colour: it does not
      // sit on the chips' own ground. Without this the rule above is met by
      // flattening the pill into the row, which loses the one control the
      // page is built around.
      const chip = screen.getByRole("link", { name: "Add department" });
      expect(getComputedStyle(pill).background).not.toBe(
        getComputedStyle(chip).background,
      );
    });

    /** @scenario "The source menu names the three vendors an admin arrives with" */
    it("offers Anthropic, OpenAI and Microsoft Copilot, and nothing else", async () => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
      renderPage();
      const user = await openSourceMenu();

      // The three vendors and nothing else that names one. The trailing row
      // is the way through to the full catalog, not a fourth vendor.
      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent),
      ).toEqual([
        "Anthropic",
        "OpenAI",
        "Microsoft Copilot",
        "Configure sources",
      ]);

      await user.click(screen.getByRole("menuitem", { name: "OpenAI" }));
      expect(harness.push).toHaveBeenCalledWith(
        "/governance/inventory?tab=sources&add=openai_admin",
      );
    });

    /** @scenario "The source menu names the three vendors an admin arrives with" */
    it("opens the sources tab on the vendor that was picked", async () => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
      renderPage();
      const user = await openSourceMenu();

      await user.click(screen.getByRole("menuitem", { name: "Anthropic" }));
      expect(harness.push).toHaveBeenCalledWith(
        "/governance/inventory?tab=sources&add=anthropic_admin",
      );
    });
  });

  describe("when the viewer cannot manage ingestion sources", () => {
    /** @scenario "Adding a source is offered only to whoever may add one" */
    it("offers no Add source control and the same three shortcuts", () => {
      renderPage();

      expect(sourcePill()).toBeUndefined();
      expect(screen.queryByText("Add source")).not.toBeInTheDocument();
      expect(wayInLabels()).toEqual([...WAY_IN_LABELS]);
    });
  });

  describe("when the viewer can ask Langy", () => {
    /** @scenario "The field offers Langy to whoever may ask" */
    it("offers to ask Langy in the field", () => {
      harness.permissions = [...VIEWER, "langy:create"];
      renderPage();

      expect(harness.placeholder).toBe(
        "Ask Langy, search, or jump to anything",
      );
      expect(wayInLabels()).toEqual([...WAY_IN_LABELS]);
    });
  });

  describe("when the viewer cannot ask Langy", () => {
    /** @scenario "The field offers Langy to whoever may ask" */
    it("offers search without Langy and the same three shortcuts", () => {
      renderPage();

      expect(harness.placeholder).toBe("Search, or jump to anything");
      expect(wayInLabels()).toEqual([...WAY_IN_LABELS]);
    });
  });

  describe("when the sections under the hero have nothing in them", () => {
    beforeEach(() => writeSampleChoice(true));
    /** @scenario "Insights and recent activity wait under the hero" */
    it("names both sections and says what will appear in each", () => {
      // The overview measures nothing, so its lists open filled with samples.
      // Their empty lines are what the reader meets after turning those off.
      writeSampleChoice(false);
      renderPage();

      expect(screen.getByText("Insights")).toBeVisible();
      expect(
        screen.getByText(
          "Nothing to report yet. Insights appear here once sources are pulling.",
        ),
      ).toBeVisible();
      expect(screen.getByText("Recent activity")).toBeVisible();
      expect(
        screen.getByText("Your recent screens will show up here."),
      ).toBeVisible();
      expect(screen.queryAllByText("sample")).toHaveLength(0);
    });

    /** @scenario "The two lists fill when samples are enabled" */
    it("opens both lists filled in, each badged as sample", () => {
      renderPage();

      expect(screen.queryAllByText("sample")).toHaveLength(2);
      expect(screen.getByText(A_SAMPLE_INSIGHT)).toBeVisible();
      expect(
        screen.queryByText(
          "Nothing to report yet. Insights appear here once sources are pulling.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Your recent screens will show up here."),
      ).not.toBeInTheDocument();
    });

    /** @scenario "An insight row reads as a severity, a headline and a date" */
    it("gives each insight a severity, a one-line headline and a date", () => {
      renderPage();

      // All three severities are offered, each as its own badge.
      for (const severity of ["Warning", "Worth a look", "Good news"]) {
        expect(screen.getByText(severity)).toBeVisible();
      }

      const headline = screen.getByText(A_SAMPLE_INSIGHT);
      const row = headline.parentElement as HTMLElement;
      // Severity, headline, date — in that order, on one line.
      expect(row.textContent).toBe(`Warning${A_SAMPLE_INSIGHT}Yesterday`);
      expect(getComputedStyle(headline).whiteSpace).toBe("nowrap");
      expect(getComputedStyle(headline).textOverflow).toBe("ellipsis");
    });

    /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
    it("makes each recent row a link carrying its name and its kind", () => {
      renderPage();

      const row = screen.getByRole("link", { name: /Engineering/ });
      expect(row).toHaveAttribute("href", "/governance/people");
      expect(row).toHaveTextContent("Engineering");

      // The kind is a chip rather than a second column of prose: its own
      // element, stamped by the same house recipe the severities use. jsdom
      // applies none of that recipe's CSS, so the class is all there is to read
      // here. The scenario's other half — that the chip keeps its width while
      // the name gives way — needs layout, which jsdom has none of. It is
      // asserted in
      // src/components/governance/home/__tests__/homeActivityChip.browser.test.tsx.
      const kind = screen.getByText("Directory");
      expect(row).toContainElement(kind);
      expect(kind.className).toContain("badge");
      expect(
        screen.getByRole("link", { name: /Release notes bot/ }),
      ).toHaveAttribute("href", "/governance/agents");
    });

    /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
    it("draws no row leading to a screen this organization is not offered", () => {
      // Costs and Insights ride the billed-cost flag; without it a sample row
      // pointing at either would lead to a page the guard refuses.
      harness.flagEnabled = false;
      renderPage();

      expect(
        screen.queryByRole("link", { name: /Spend by department/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /Monthly review/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Engineering/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "The overview carries the section's sample toggle" */
    it("carries the section's sample toggle, and it empties both lists", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );

      expect(screen.queryAllByText("sample")).toHaveLength(0);
      expect(
        screen.getByText("Your recent screens will show up here."),
      ).toBeVisible();
      // The press is the section's answer, not this page's: it is the same
      // one every other governance screen reads back.
      expect(readSampleChoice()).toBe(false);
    });
  });

  describe("the measure the field is set to", () => {
    /** @scenario "The field is the width the project home sets its own field to" */
    it("matches the project home field, and stays inside the wider page column", async () => {
      const { container } = renderPage();

      const field = screen.getByPlaceholderText(/jump to anything/);
      const fieldColumn = boxedAncestorWidth(field, "maxWidth");
      expect(fieldColumn).toBe(await projectHomeAskMeasure());

      // The shortcuts hang off the field, so they take its measure too: the
      // chip row shares that same bounded ancestor.
      const chip = screen.getByRole("link", { name: "Add department" });
      expect(boxedAncestorWidth(chip, "maxWidth")).toBe(fieldColumn);

      // The page column stays wider. Narrowing it to the field would take the
      // two lists below down with it, and their rows are a badge, a headline
      // and a date across two columns.
      const pageColumn = boxedAncestorWidth(
        screen.getByRole("heading", { name: "AI Governance" }),
        "maxWidth",
      );
      expect(parseInt(pageColumn, 10)).toBeGreaterThan(
        parseInt(fieldColumn, 10),
      );
      expect(container).toBeTruthy();
    });
  });

  describe("the ground the hero stands on", () => {
    /** @scenario "The hero stands on the same lit ground as the project home" */
    it("is decoration: hidden from assistive technology and untouchable", () => {
      const { container } = renderPage();

      const decorations = container.querySelectorAll("[aria-hidden='true']");
      const ground = [...decorations].filter(
        (node) => getComputedStyle(node).pointerEvents === "none",
      );
      expect(ground.length).toBeGreaterThan(0);
      // The field and the pill above it are still the things you can reach.
      expect(screen.getByText("Good morning")).toBeVisible();
    });
  });

  describe("when the Insights screen is offered to the organization", () => {
    /** @scenario "Setting up insights is offered only where the screen exists" */
    it("offers Set up insights, and offers nothing in its place when it is not", () => {
      renderPage();
      expect(
        screen.getByRole("link", { name: "Set up insights" }),
      ).toHaveAttribute("href", "/governance/insights");

      cleanup();
      harness.flagEnabled = false;
      renderPage();
      expect(screen.queryByText("Set up insights")).not.toBeInTheDocument();
    });
  });

  describe("when every activity-monitor read would be refused", () => {
    /** @scenario "The overview renders no error alert and issues no spend read" */
    it("shows no error and issues no activity-monitor read at all", () => {
      harness.errors["activityMonitor.summary"] = enterpriseLocked();
      harness.errors["activityMonitor.recentAnomalies"] = enterpriseLocked();
      renderPage();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/Enterprise plan/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
      // Not merely unrendered: the reads that produced those refusals are
      // never issued, so nothing is left to fail.
      expect(
        harness.requested.filter(
          (path) =>
            path.startsWith("activityMonitor.") ||
            path.startsWith("ingestionSources.") ||
            path.startsWith("anomalyRules.") ||
            path.startsWith("sessionPolicy."),
        ),
      ).toEqual([]);
      expect(screen.getByText("Good morning")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Add department" }),
      ).toBeVisible();
    });
  });

  describe("when the section's control rules are applied to it", () => {
    /** @scenario "No governance page renders a native select" */
    it("contains no native select element, sample or real", async () => {
      // On `document.body` rather than the render's own container: the vendor
      // menu portals out of it, and the rule is about the whole page.

      // The grant that draws the vendor pill, so the menu below is reachable.
      harness.permissions = [...VIEWER, "ingestionSources:manage"];

      writeSampleChoice(true);
      renderPage();
      expect(findNativeSelects(document.body)).toHaveLength(0);

      // And with the menu down, which is the one place on this page a choice
      // is offered at all.
      await openSourceMenu();
      expect(findNativeSelects(document.body)).toHaveLength(0);
      cleanup();

      // And again with the samples off, which is this page's real state: it
      // reads nothing, so empty is the only data it ever has.
      writeSampleChoice(false);
      renderPage();
      expect(
        screen.getByText("Your recent screens will show up here."),
      ).toBeVisible();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});
