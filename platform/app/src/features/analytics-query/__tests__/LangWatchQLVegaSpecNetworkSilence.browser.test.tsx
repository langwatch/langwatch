/**
 * Every specification in the corpus, put through the real chart surface in a
 * real browser while the browser's own network activity is recorded.
 *
 * The unit suites prove each adversarial fixture is refused by the rule that
 * names it. What they cannot prove is the thing the refusals exist for: that
 * nothing left the browser. This runs the whole corpus — adversarial, merely
 * invalid, and valid — through `validateVegaLiteSpec` *and* through a real
 * mount of `LangWatchQLVegaLiteChart`, and watches four channels at once:
 * `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, and the browser's own
 * Resource Timing buffer, which records loads no wrapper can see (an `<img>`
 * source, a stylesheet, a font).
 *
 * The recorders are proven to work at the end of the test rather than assumed:
 * one deliberate same-origin call through each channel has to show up in its
 * recorder, because an absence assertion that cannot fail is worth nothing.
 *
 * Spec: specs/analytics/lwql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import "@testing-library/jest-dom/vitest";

vi.mock("~/utils/compat/next-dynamic", () => {
  function StubSpecEditor() {
    return <textarea data-testid="spec-editor-input" readOnly value="" />;
  }

  return { __esModule: true, default: () => StubSpecEditor };
});

import { LangWatchQLVegaLiteChart } from "../components/LangWatchQLVegaLiteChart";
import { validateVegaLiteSpec } from "../visualization/validateVegaLiteSpec";
import type {
  LangWatchQLDataset,
  LangWatchQLDatasetColumn,
} from "../visualization/visualization.types";

import { ADVERSARIAL_VEGA_FIXTURES } from "./fixtures/adversarial";
import { INVALID_VEGA_FIXTURES } from "./fixtures/invalid";
import { LWQL_FIXTURE_COLUMNS } from "./fixtures/lwqlDatasetRegistry";
import { VALID_VEGA_FIXTURES } from "./fixtures/valid";

/**
 * Small datasets on purpose: the row ceilings are maxima, and what is under
 * test here is network silence rather than volume. Every column the registry
 * declares is populated, so a fixture that reads any of them draws.
 */
const ROWS_PER_DATASET = 12;

const QUERY_RESULT_ROWS: LangWatchQLDataset = Array.from(
  { length: ROWS_PER_DATASET },
  (_, index) => ({
    model: `model-${index % 4}`,
    total: index * 3 + 1,
    latency: index * 1.5 + 0.5,
    bucket: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    series: index % 2 === 0 ? "primary" : "secondary",
    payload: `payload-${index}`,
  }),
);

const MODEL_CATALOG_ROWS: LangWatchQLDataset = [
  "model-0",
  "model-1",
  "model-2",
  "model-3",
].map((model, index) => ({ model, vendor: `vendor-${index}` }));

const DATASETS: Readonly<Record<string, LangWatchQLDataset>> = {
  query_result: QUERY_RESULT_ROWS,
  model_catalog: MODEL_CATALOG_ROWS,
};

const COLUMNS_BY_DATASET: Readonly<Record<string, readonly LangWatchQLDatasetColumn[]>> =
  LWQL_FIXTURE_COLUMNS;

const ROW_COUNTS = Object.fromEntries(
  Object.entries(DATASETS).map(([name, rows]) => [name, rows.length]),
);

/** The corpus, with what each entry is expected to do at the chart surface. */
interface CorpusEntry {
  readonly name: string;
  readonly spec: unknown;
  /** Whether the LangWatchQL policy admits it, and therefore whether it draws. */
  readonly admitted: boolean;
}

const CORPUS: readonly CorpusEntry[] = [
  ...ADVERSARIAL_VEGA_FIXTURES.map((fixture) => ({
    name: `adversarial/${fixture.name}`,
    spec: fixture.spec,
    admitted: false,
  })),
  ...INVALID_VEGA_FIXTURES.map((fixture) => ({
    name: `invalid/${fixture.name}`,
    spec: fixture.spec,
    admitted: false,
  })),
  ...VALID_VEGA_FIXTURES.map((fixture) => ({
    name: `valid/${fixture.name}`,
    spec: fixture.spec,
    admitted: true,
  })),
];

/** Every request the page makes, whoever makes it. */
interface NetworkRecorder {
  readonly requests: string[];
  readonly resourceUrls: () => string[];
  readonly release: () => void;
}

function recordNetwork(): NetworkRecorder {
  const requests: string[] = [];

  const realFetch = globalThis.fetch;
  const realOpen = XMLHttpRequest.prototype.open as (
    this: XMLHttpRequest,
    ...args: unknown[]
  ) => void;
  const realBeacon = navigator.sendBeacon;

  globalThis.fetch = function recordedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const url =
      typeof input === "string" || input instanceof URL ? String(input) : input.url;
    requests.push(`fetch ${url}`);
    return realFetch.call(globalThis, input, init);
  } as typeof globalThis.fetch;

  XMLHttpRequest.prototype.open = function recordedOpen(
    this: XMLHttpRequest,
    ...args: unknown[]
  ) {
    requests.push(`xhr ${String(args[0])} ${String(args[1])}`);
    return realOpen.apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;

  navigator.sendBeacon = function recordedBeacon(url: string | URL) {
    requests.push(`beacon ${String(url)}`);
    return true;
  } as typeof navigator.sendBeacon;

  // A wrapper cannot see an image source or a stylesheet link. The browser's
  // own buffer can, so it is cleared here and read as the second channel.
  performance.setResourceTimingBufferSize(1000);
  performance.clearResourceTimings();

  return {
    requests,
    resourceUrls: () =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    release: () => {
      globalThis.fetch = realFetch;
      XMLHttpRequest.prototype.open = realOpen as typeof XMLHttpRequest.prototype.open;
      navigator.sendBeacon = realBeacon;
    },
  };
}

const withChakra = (element: ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);

function chartOf(spec: unknown): ReactElement {
  return (
    <LangWatchQLVegaLiteChart
      spec={spec}
      datasets={DATASETS}
      columnsByDataset={COLUMNS_BY_DATASET}
    />
  );
}

function chartStatus(container: ParentNode): string | null {
  return (
    container
      .querySelector('[data-testid="lwql-vega-chart-view"]')
      ?.getAttribute("data-chart-status") ?? null
  );
}

async function poll(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}

/** What one fixture did, as a single line the whole corpus can be compared as. */
type CorpusOutcome = string;

/**
 * Validates one fixture and attempts to render it, reporting what happened.
 *
 * Rendering is attempted for every fixture, refused or not: a refusal that
 * only ever happens in a direct call to the validator would say nothing about
 * what the component does when it is handed the same specification.
 */
async function attemptToRender(entry: CorpusEntry): Promise<CorpusOutcome> {
  const validation = validateVegaLiteSpec({
    spec: entry.spec,
    columnsByDataset: COLUMNS_BY_DATASET,
    rowCountsByDataset: ROW_COUNTS,
  });

  const mounted = withChakra(chartOf(entry.spec));
  const { container } = mounted;
  try {
    if (validation.ok) {
      await poll(() => chartStatus(container) === "ready");
      return `${entry.name} admitted status=${chartStatus(container)}`;
    }

    const refusalShown = await poll(
      () => container.querySelector('[data-testid="lwql-chart-failure"]') !== null,
    );
    // `idle` is the runtime never having been enabled — the refusal stopped
    // this specification before anything was handed to Vega.
    return `${entry.name} refused=${refusalShown} status=${chartStatus(container)}`;
  } finally {
    mounted.unmount();
  }
}

/** The line each fixture must produce, derived from the corpus rather than observed. */
function expectedOutcome(entry: CorpusEntry): CorpusOutcome {
  return entry.admitted
    ? `${entry.name} admitted status=ready`
    : `${entry.name} refused=true status=idle`;
}

beforeEach(async () => {
  await page.viewport(1024, 768);
});

afterEach(() => cleanup());

describe("the LangWatchQL chart surface with the browser's network recorded", () => {
  describe("given the whole specification corpus", () => {
    describe("when each specification is validated and rendering is attempted", () => {
      /** @scenario "Rejected and adversarial specs cause no network request" */
      it("triggers no request from any specification, refused or admitted", async () => {
        // Warm the surface once before the recorders go on, so the first
        // paint's own styling work is not attributed to a fixture.
        const warmup = withChakra(chartOf(VALID_VEGA_FIXTURES[0]?.spec));
        await poll(() => chartStatus(document) === "ready");
        warmup.unmount();

        const network = recordNetwork();
        const outcomes: CorpusOutcome[] = [];

        try {
          for (const entry of CORPUS) {
            outcomes.push(await attemptToRender(entry));
          }

          // Every fixture behaved as the corpus says it must, so the sweep
          // really did exercise both halves — the refusals and the renders.
          expect(outcomes).toEqual(CORPUS.map(expectedOutcome));

          // The whole point: nothing left the browser.
          expect(network.requests).toEqual([]);
          expect(network.resourceUrls()).toEqual([]);

          // The recorders are not vacuous — a deliberate call through each
          // channel has to register: fetch and Resource Timing share one
          // call, XHR and beacon each get their own.
          await fetch(globalThis.location.href);
          new XMLHttpRequest().open("GET", globalThis.location.href);
          navigator.sendBeacon(globalThis.location.href);
          expect(network.requests).toEqual([
            `fetch ${globalThis.location.href}`,
            `xhr GET ${globalThis.location.href}`,
            `beacon ${globalThis.location.href}`,
          ]);
          await poll(() => network.resourceUrls().length > 0);
          expect(network.resourceUrls()).toContain(globalThis.location.href);
        } finally {
          network.release();
        }
      });
    });
  });
});
