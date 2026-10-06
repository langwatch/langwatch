// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The overview hero's chrome, as it is drawn: the lead control's treatment, the lit ground, the
 * field's measure, and where the shortcuts lead. Real pages over the fake host; the API and the
 * shader's canvas are the only boundaries mocked.
 * @see specs/ai-governance/dashboard/governance-overview-hero.feature
 */
import "@testing-library/jest-dom/vitest";
import { HeroLeadPill } from "@langwatch/design-system/hero-lead-pill";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addSourceHref } from "../../../../features/overview/ui/sections/governance-hero.tsx";
import { FakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({
  ground: [] as { speed?: number; colors?: string[] }[],
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: (props: { speed?: number; colors?: string[] }) => {
    harness.ground.push(props);
    return <div data-testid="mesh-ground" />;
  },
}));
vi.mock("../../../../behavior/lent-hero-ask-field.tsx", () => ({
  HeroAskField: ({ placeholder }: { placeholder: string }) => (
    <input data-testid="ask-field" placeholder={placeholder} />
  ),
}));
vi.mock("../../../../features/overview/ui/sections/quarantine-fill-panel.tsx", () => ({
  QuarantineFillAlert: () => null,
}));
vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), goBack: vi.fn() }),
}));
vi.mock("../../../../behavior/governance-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({
              data: undefined,
              isLoading: false,
              isFetching: false,
              isError: false,
              error: null,
              refetch: vi.fn(),
            });
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

import GovernanceInventoryPage from "../governance-inventory.screen.tsx";
import GovernanceOverviewPage from "../governance-overview.screen.tsx";
import GovernancePeoplePage from "../governance-people.screen.tsx";

const ADMIN = [
  "organization:view",
  "governance:view",
  "activityMonitor:view",
  "ingestionSources:manage",
  "aiTools:manage",
  "anomalyRules:view",
];

function renderOverview() {
  const host = FakeGovernanceHost.create({ permissions: ADMIN });
  renderWithGovernanceHost(<GovernanceOverviewPage />, { host });
  return host;
}

beforeEach(() => {
  window.sessionStorage.clear();
  harness.ground = [];
});
afterEach(() => cleanup());

/** `ASK_MEASURE` in the project home hero (modules/project .../langy-home-hero.tsx), in pixels. */
const PROJECT_HOME_ASK_MEASURE_PX = 680;

const PAINT_PROPERTIES = [
  "background",
  "background-color",
  "border-color",
  "border-top-color",
  "color",
  "fill",
  "stroke",
];

/** Everything an element and what it draws inside it paints with, as the cascade resolved it. */
function paintOf(root: Element): string[] {
  return [root, ...root.querySelectorAll("*")].flatMap((element) => {
    const style = getComputedStyle(element);
    return PAINT_PROPERTIES.map((property) => style.getPropertyValue(property)).filter(Boolean);
  });
}

const ACCENT = /orange|accent|brand|primary|purple/;

const nearestMeasurePx = (element: Element): number | undefined => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const measure = getComputedStyle(node).maxWidth;
    if (measure.endsWith("px")) return Number.parseFloat(measure);
  }
  return undefined;
};

describe("given an admin who may manage sources", () => {
  /** @scenario "The lead action is an outline control rather than a filled one" */
  it("draws Add source with no accent anywhere in it, heavier than the shortcuts by surface, mark and caret", () => {
    renderOverview();
    const pill = screen.getByRole("button", { name: /Add source/ });
    const shortcut = screen.getByRole("link", { name: "Add tool" });

    expect(paintOf(pill).filter((paint) => ACCENT.test(paint))).toEqual([]);

    expect(getComputedStyle(pill).background).toContain("bg-muted");
    expect(getComputedStyle(shortcut).background).not.toContain("bg-muted");
    const glyphTiles = Array.from(pill.querySelectorAll("div")).filter((tile) =>
      getComputedStyle(tile).background.includes("bg-surface"),
    );
    expect(glyphTiles).toHaveLength(3);
    expect(pill.children).toHaveLength(3);
    expect(pill.lastElementChild).toHaveAttribute("aria-hidden", "true");
    expect(pill.lastElementChild?.querySelector("svg")).not.toBeNull();
    expect(shortcut.children).toHaveLength(1);
  });

  it("recognises an accent when the same pill is drawn filled, so the check above can fail", () => {
    renderWithDesignSystem(<HeroLeadPill label="Filled" glyphs={[]} prominent />);

    const filled = screen.getByRole("button", { name: "Filled" });
    expect(paintOf(filled).some((paint) => ACCENT.test(paint))).toBe(true);
  });
});

describe("given the overview renders", () => {
  /** @scenario "Top-level /governance renders the dashboard" */
  it("renders the AI Governance heading with the hero and its ways in and sends the address nowhere", () => {
    const host = renderOverview();

    expect(screen.getByRole("heading", { name: "AI Governance" })).toBeInTheDocument();
    expect(screen.getByTestId("ask-field")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add source/ })).toBeInTheDocument();
    for (const name of ["Add department", "Add agent", "Add tool"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(host.recording.navigations).toEqual([]);
    expect(host.recording.queries).toEqual([]);
  });

  /** @scenario "The hero stands on the same lit ground as the project home" */
  it("lights the hero with a moving, aria-hidden, click-through mesh and leaves the field and pill reachable", async () => {
    renderOverview();

    const mesh = screen.getByTestId("mesh-ground");
    const ground = mesh.closest('[aria-hidden="true"]');
    expect(ground).not.toBeNull();
    expect(getComputedStyle(ground as Element).pointerEvents).toBe("none");
    expect(harness.ground.at(-1)?.speed).toBeGreaterThan(0);
    expect(harness.ground.at(-1)?.colors).toHaveLength(3);

    const field = screen.getByTestId("ask-field");
    const pill = screen.getByRole("button", { name: /Add source/ });
    expect(field.closest('[aria-hidden="true"]')).toBeNull();
    expect(pill.closest('[aria-hidden="true"]')).toBeNull();
    expect(ground?.parentElement).toContainElement(field);
    await userEvent.click(pill);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  /** @scenario "The field is the width the project home sets its own field to" */
  it("holds the field, the pill and the shortcuts to the project home's measure and lets the lists run wider", () => {
    renderOverview();

    const field = screen.getByTestId("ask-field");
    const measure = nearestMeasurePx(field);
    expect(measure).toBeLessThanOrEqual(PROJECT_HOME_ASK_MEASURE_PX);
    const column = field.closest("div") as HTMLElement;
    let holder: HTMLElement | null = column;
    while (holder && getComputedStyle(holder).maxWidth === "none") holder = holder.parentElement;
    expect(holder).toContainElement(screen.getByRole("button", { name: /Add source/ }));
    expect(holder).toContainElement(screen.getByRole("link", { name: "Add tool" }));

    for (const label of ["Insights", "Recent activity"]) {
      const lists = nearestMeasurePx(screen.getByText(label));
      expect(lists).toBeGreaterThan(measure ?? Number.POSITIVE_INFINITY);
      expect(holder).not.toContainElement(screen.getByText(label));
    }
  });

  /** @scenario "No shortcut points at a tab the page would not honour" */
  it("names, in every shortcut that carries a tab, a tab its destination opens on, and only to pages that have tabs", async () => {
    const host = renderOverview();
    await userEvent.click(screen.getByRole("button", { name: /Add source/ }));
    const hrefs = new Set(
      Array.from(document.body.querySelectorAll("a[href]")).map(
        (a) => a.getAttribute("href") ?? "",
      ),
    );
    for (const index of [0, 1, 2]) {
      if (!screen.queryByRole("menu")) {
        await userEvent.click(screen.getByRole("button", { name: /Add source/ }));
      }
      await userEvent.click((await screen.findAllByRole("menuitem"))[index] ?? document.body);
    }
    for (const to of host.recording.navigations) hrefs.add(to);
    expect(hrefs.has(addSourceHref("openai_admin"))).toBe(true);

    const carrying = [...hrefs]
      .map((href) => new URL(href, "http://governance.test"))
      .filter((url) => url.searchParams.has("tab"));
    expect(carrying.length).toBeGreaterThanOrEqual(5);

    const destinations: Record<string, () => ReactElement> = {
      "/governance/inventory": () => <GovernanceInventoryPage />,
      "/governance/people": () => <GovernancePeoplePage />,
    };
    for (const url of carrying) {
      cleanup();
      const destination = destinations[url.pathname];
      expect(
        destination,
        `${url.pathname} carries a tab but is not a page that has tabs`,
      ).toBeDefined();
      const query: Record<string, string> = Object.fromEntries(url.searchParams);
      renderWithGovernanceHost(destination?.() ?? <></>, {
        host: FakeGovernanceHost.create({ permissions: ADMIN, query }),
      });
      const open = screen
        .getAllByRole("tab")
        .filter((tab) => tab.getAttribute("aria-selected") === "true");
      expect(open.map((tab) => tab.textContent?.toLowerCase().trim())).toEqual([
        url.searchParams.get("tab"),
      ]);
    }
  }, 60_000);
});
