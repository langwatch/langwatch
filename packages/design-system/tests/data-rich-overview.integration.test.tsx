/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import previewAnnotations from "../.storybook/preview.tsx";
import { toaster } from "../src/components/overlays/toaster.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import {
  DAILY,
  DataRichOverview,
  SEED_TRACES,
  type RefreshTraces,
} from "../src/workshop/data-rich-overview.example.tsx";
import { dataRichOverviewSource } from "../src/workshop/data-rich-overview.source.ts";
import * as overviewStories from "../src/workshop/data-rich-overview.stories.tsx";

beforeAll(() => {
  window.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  toaster.remove();
});

afterEach(() => {
  cleanup();
  toaster.remove();
});

function composedFor(mode: "light" | "dark") {
  return composeStories(overviewStories, {
    ...previewAnnotations,
    initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
  });
}

const FIRST = SEED_TRACES[0]?.name ?? "";
const checkbox = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` });
const nameOf = (id: number) => SEED_TRACES.find((trace) => trace.id === id)?.name ?? "";

function chartName(): string | undefined {
  return screen
    .getAllByRole("figure")
    .map((image) => image.getAttribute("aria-label") ?? "")
    .find((label) => /per day/.test(label));
}

const visibleStates = {
  Default: async () => {
    expect(await screen.findByRole("heading", { name: "Monitoring" })).toBeTruthy();
    expect(screen.getByText("Requests this week")).toBeTruthy();
    expect(screen.getByText("Errors this week")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Requests/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(chartName()).toBe("Requests per day");
    expect(screen.getByRole("button", { name: FIRST })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(11);
  },
  SelectedRows: async () => {
    expect(await screen.findByText("2 selected")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Selection actions" })).toBeTruthy();
    expect(checkbox(nameOf(2))).toBeChecked();
    expect(checkbox(nameOf(5))).toBeChecked();
    expect(screen.getByRole("button", { name: "Export selected" })).toBeTruthy();
  },
  InlineSelection: async () => {
    const bar = await screen.findByRole("group", { name: "Selection actions" });
    expect(bar.getAttribute("data-placement")).toBe("inline");
    expect(within(bar).getByText("2 selected")).toBeTruthy();
  },
  SecondPage: async () => {
    expect(await screen.findByRole("button", { name: nameOf(11) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: FIRST })).toBeNull();
    expect(screen.getByTestId("pagination-indicator").textContent).toContain("showing 11–20");
    expect(screen.getByText("1 selected")).toBeTruthy();
  },
  Loading: async () => {
    expect(await screen.findByLabelText("Loading the chart")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search traces" })).toBeDisabled();
    expect(screen.getByRole("table", { name: "Traces to review" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.queryByRole("button", { name: FIRST })).toBeNull();
  },
  Empty: async () => {
    expect(await screen.findByText("No traces yet")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Read about tracing" }).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Copy a prompt for your coding agent" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("No data for this period")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search traces" })).toBeNull();
  },
  NoResults: async () => {
    expect(await screen.findByText(/No traces for "chargeback" with status Error/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("chargeback");
  },
  Failed: async () => {
    expect(await screen.findByText("Couldn't load the traces")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read about tracing" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Traces to review" })).toBeNull();
    expect(screen.getByText("Requests this week")).toBeTruthy();
  },
  Refreshing: async () => {
    expect(await screen.findByText("Refreshing…")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Traces to review" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: FIRST })).toBeTruthy();
  },
  RefreshFailed: async () => {
    expect(await screen.findByText("Couldn't refresh the traces")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: FIRST })).toBeTruthy();
  },
  ChartEmpty: async () => {
    expect(await screen.findByText("No data for this period")).toBeTruthy();
    expect(screen.getByText("Metrics start a minute after the first trace arrives.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read about tracing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: FIRST })).toBeTruthy();
  },
  Narrow: async () => {
    expect(await screen.findByRole("heading", { name: "Monitoring" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Traces to review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  },
};

describe("the Data-rich overview pattern", () => {
  describe.each(["light", "dark"] as const)("given the %s colour mode", (mode) => {
    const stories = composedFor(mode);

    it("has a test for every named story", () => {
      expect(Object.keys(stories).toSorted()).toEqual(Object.keys(visibleStates).toSorted());
    });

    describe.each(Object.entries(visibleStates))("when %s is rendered", (name, expectState) => {
      /** @scenario Every overview story shows its state in light and dark */
      it("shows its own state", async () => {
        const Story = stories[name as keyof typeof stories];
        render(<Story />);
        expect(document.documentElement.classList.contains(mode)).toBe(true);
        await expectState();
      });
    });
  });
});

describe("given the overview of a week", () => {
  /** @scenario The figures, the chart and its summary agree */
  it("shows the summed requests and a chart description naming the busiest and quietest day", () => {
    renderWithDesignSystem(<DataRichOverview />);
    const total = DAILY.reduce((sum, day) => sum + day.requests, 0);
    expect(
      screen.getByRole("tab", { name: `Requests ${total.toLocaleString("en-US")}` }),
    ).toBeTruthy();

    const image = screen.getByRole("figure", { name: "Requests per day" });
    const description =
      document.getElementById(image.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
    const busiest = DAILY.reduce((best, day) => (day.requests > best.requests ? day : best));
    const quietest = DAILY.reduce((best, day) => (day.requests < best.requests ? day : best));
    expect(description).toContain(`${DAILY.length} readings from ${DAILY[0]?.label} to`);
    expect(description).toContain(
      `Highest ${busiest.requests.toLocaleString("en-US")} requests on ${busiest.label}`,
    );
    expect(description).toContain(
      `lowest ${quietest.requests.toLocaleString("en-US")} requests on ${quietest.label}`,
    );
  });
});

describe("given the overview showing requests", () => {
  describe("when the reader arrows to the Cost tab", () => {
    /** @scenario A metric tab changes the chart only when activated */
    it("keeps the requests chart until Enter, then shows cost per day", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DataRichOverview />);
      screen.getByRole("tab", { name: /^Requests/ }).focus();

      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(screen.getByRole("tab", { name: /^Cost/ })).toHaveFocus());
      expect(chartName()).toBe("Requests per day");

      await user.keyboard("{Enter}");
      await waitFor(() => expect(chartName()).toBe("Cost per day (USD)"));
      const image = screen.getByRole("figure", { name: "Cost per day (USD)" });
      const highest = Math.max(...DAILY.map((day) => day.costUsd));
      expect(
        document.getElementById(image.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toContain(`Highest $${highest.toFixed(2)}`);
    });
  });
});

describe("given the overview showing requests, when the reader opens the Latency tab", () => {
  /** @scenario The latency tab explains its headline */
  it("names the tab Latency (p95) and says the headline averages the daily p95 values", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<DataRichOverview />);
    await user.click(screen.getByRole("tab", { name: /^Latency \(p95\)/ }));
    await waitFor(() => expect(chartName()).toBe("Latency per day, 95th percentile"));
    expect(
      screen.getByText(
        "The headline is the average of the daily p95 values; the chart shows each day's p95.",
      ),
    ).toBeTruthy();
  });
});

describe("given the trace table", () => {
  describe("when the reader ticks two traces and exports them", () => {
    /** @scenario Two ticked rows are exactly what is exported */
    it("previews and hands over only those two", async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      renderWithDesignSystem(<DataRichOverview onExport={onExport} />);
      await user.click(checkbox(nameOf(3)));
      await user.click(checkbox(nameOf(7)));
      expect(screen.getByText("2 selected")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Export selected" }));
      const dialog = await screen.findByRole("dialog", { name: "Export 2 traces" });
      const rows = within(within(dialog).getByRole("table")).getAllByRole("row").slice(1);
      expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
        nameOf(3),
        nameOf(7),
      ]);

      await user.click(within(dialog).getByRole("button", { name: "Download CSV" }));
      expect(onExport).toHaveBeenCalledOnce();
      expect(onExport.mock.calls[0]?.[0].traces.map((trace: { id: number }) => trace.id)).toEqual([
        3, 7,
      ]);
      expect(await screen.findByText("Exported 2 traces")).toBeTruthy();
    });
  });

  describe("when the reader ticks a row or opens its menu", () => {
    /** @scenario Ticking and menus do not open the detail */
    it("opens the detail only from the name or View details", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DataRichOverview />);
      await user.click(checkbox(FIRST));
      await user.click(screen.getByRole("button", { name: `Actions for ${FIRST}` }));
      expect(await screen.findByRole("menuitem", { name: "View details" })).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: FIRST })).toBeNull();

      await user.click(screen.getByRole("menuitem", { name: "View details" }));
      const drawer = await screen.findByRole("dialog", { name: FIRST });
      expect(within(drawer).getByText("trace-001")).toBeTruthy();
      const close = drawer.querySelector<HTMLButtonElement>('[data-frame-action="cancel"]');
      if (!close) throw new Error("The drawer has no Close button");
      expect(close.textContent).toBe("Close");
      await user.click(close);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: FIRST })).toBeNull());

      await user.click(screen.getByRole("button", { name: nameOf(2) }));
      expect(await screen.findByRole("dialog", { name: nameOf(2) })).toBeTruthy();
    });
  });

  describe("when the reader sorts and pages with a trace ticked", () => {
    /** @scenario Sorting and paging keep the ticked traces */
    it("keeps the one ticked trace counted and ticked across sort and page", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DataRichOverview />);
      await user.click(checkbox(FIRST));

      await user.click(screen.getByRole("button", { name: "Cost (USD)" }));
      expect(screen.getByRole("columnheader", { name: /Cost/ }).getAttribute("aria-sort")).toBe(
        "descending",
      );
      await user.click(screen.getByTestId("pagination-next"));
      expect(screen.getByTestId("pagination-indicator").textContent).toContain("showing 11–20");
      expect(screen.getByText("1 selected")).toBeTruthy();

      const costliest = [...SEED_TRACES].toSorted((a, b) => b.costUsd - a.costUsd || a.id - b.id);
      expect(screen.getByRole("button", { name: costliest[10]?.name ?? "" })).toBeTruthy();

      const home = Math.floor(costliest.findIndex((trace) => trace.name === FIRST) / 10) + 1;
      const away = home === 1 ? 2 : 1;
      await user.click(screen.getByTestId(`pagination-page-${away}`));
      expect(screen.queryByRole("checkbox", { name: `Select ${FIRST}` })).toBeNull();
      expect(screen.getByText("1 selected")).toBeTruthy();

      await user.click(screen.getByTestId(`pagination-page-${home}`));
      expect(checkbox(FIRST)).toBeChecked();
    });
  });

  describe("when a search matches nothing", () => {
    /** @scenario A search with no match offers a way out */
    it("says so, offers a prompt and Clear filters brings the traces back", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DataRichOverview />);
      await user.type(screen.getByRole("searchbox", { name: "Search traces" }), "chargeback");

      expect(await screen.findByText(/No traces for "chargeback"\./)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
      ).toBeTruthy();
      await user.click(
        screen.getAllByRole("button", { name: "Clear filters" })[0] ?? document.body,
      );
      expect(await screen.findByRole("button", { name: FIRST })).toBeTruthy();
      expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
    });
  });

  describe("when the status filter and the column picker are used", () => {
    /** @scenario The status filter and the column picker narrow what is shown */
    it("leaves only failed traces and no Model column", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DataRichOverview />);
      expect(screen.getByRole("columnheader", { name: "Model" })).toBeTruthy();

      const errors = SEED_TRACES.filter((trace) => trace.status === "error");
      await user.click(
        screen.getByRole("button", { name: new RegExp(`^Error, ${errors.length}`) }),
      );
      expect(screen.getAllByRole("row")).toHaveLength(errors.length + 1);
      expect(screen.getByText(`${errors.length} of ${SEED_TRACES.length} traces`)).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Show or hide columns" }));
      await user.click(await screen.findByRole("menuitemcheckbox", { name: "Model" }));
      await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Model" })).toBeNull());
    });
  });
});

describe("given a trace load that fails once", () => {
  /** @scenario A failed load can be retried */
  it("keeps the error after a failed retry and shows the traces after the next", async () => {
    const user = userEvent.setup();
    let refusals = 1;
    const refresh: RefreshTraces = () =>
      refusals-- > 0
        ? Promise.reject(new Error("The trace service did not answer."))
        : Promise.resolve();
    renderWithDesignSystem(<DataRichOverview refresh={refresh} start={{ traces: "error" }} />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Couldn't load the traces")).toBeTruthy();
    expect(screen.queryByRole("button", { name: FIRST })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: FIRST })).toBeTruthy();
    expect(screen.queryByText("Couldn't load the traces")).toBeNull();
  });
});

describe("given a refresh that fails", () => {
  /** @scenario A failed refresh keeps the old traces */
  it("keeps the rows, offers Try again and clears the banner when it works", async () => {
    const user = userEvent.setup();
    let refusals = 1;
    const refresh: RefreshTraces = () =>
      refusals-- > 0
        ? Promise.reject(new Error("The trace service did not answer."))
        : Promise.resolve();
    renderWithDesignSystem(<DataRichOverview refresh={refresh} />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Couldn't refresh the traces")).toBeTruthy();
    expect(screen.getByRole("button", { name: FIRST })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Couldn't refresh the traces")).toBeNull());
    expect(screen.getByRole("button", { name: FIRST })).toBeTruthy();
  });
});

describe("given the overview opened with inline selection", () => {
  /** @scenario Inside an overlay the selection bar sits in the toolbar */
  it("draws the bar in normal flow, not fixed to the viewport", () => {
    renderWithDesignSystem(
      <DataRichOverview selectionPlacement="inline" start={{ selected: [1] }} />,
    );
    const bar = screen.getByRole("group", { name: "Selection actions" });
    expect(bar.getAttribute("data-placement")).toBe("inline");
    expect(bar.closest("[data-table-toolbar]")).not.toBeNull();
  });
});

describe("given the source of the example", () => {
  /** @scenario The example uses only public design system entry points */
  it("imports no Chakra, Emotion or design system file by relative path", () => {
    const specifiers = [...dataRichOverviewSource.matchAll(/from "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(specifiers.length).toBeGreaterThan(10);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "react" || specifier?.startsWith("@langwatch/design-system/") === true;
      expect(allowed, `${specifier} is not a public entry point`).toBe(true);
    }
  });
});
