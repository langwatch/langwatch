/**
 * @vitest-environment jsdom
 *
 * The declarative card renders every catalog-described result from its body
 * widget — rows, facts, stats, diff, text — plus the honest failure state:
 * output that cannot be read renders as "couldn't read this result", never as
 * a confident wrong empty state.
 *
 * Descriptors come from `resolveCapability` on real tool names, so these tests
 * exercise the same resolution path the panel does, with real-shaped payloads.
 *
 * @see specs/langy/langy-capability-cards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { CliResultDigest } from "@langwatch/cli-cards";
import { render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCapability } from "../components/capabilities/capabilityRegistry";
import { LangyDeclarativeCard } from "../components/capabilities/LangyDeclarativeCard";
import type { CapabilityData } from "../hooks/useCapabilityData";

// The hydration seam is mocked: these tests pin RENDERING per hydration state;
// the hook's own resolution rules live in useCapabilityData.unit.test.tsx.
const idleData: CapabilityData = {
  status: "idle",
  rows: [],
  loadedCount: 0,
  totalCount: null,
  isHydrating: false,
};
const useCapabilityDataMock = vi.fn((): CapabilityData => idleData);
vi.mock("../hooks/useCapabilityData", () => ({
  useCapabilityData: () => useCapabilityDataMock(),
}));

// jsdom measures every element as 0x0, at which recharts' ResponsiveContainer
// draws nothing at all — so the chart body would be invisible to the test for
// a reason that has nothing to do with the card.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    // Typed with the props being injected: a bare `ReactElement` has unknown
    // props, so `cloneElement` has no overload that accepts these.
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

beforeEach(() => {
  useCapabilityDataMock.mockReturnValue(idleData);
});

function renderCard({
  name,
  input = {},
  output,
}: {
  name: string;
  input?: unknown;
  output: unknown;
}) {
  const descriptor = resolveCapability(name);
  if (!descriptor) throw new Error(`no descriptor for ${name}`);
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyDeclarativeCard
        descriptor={descriptor}
        input={input}
        output={output}
        projectSlug="acme"
      />
    </ChakraProvider>,
  );
}

// The global test-setup defines a non-configurable window.matchMedia stub, so
// this assigns over it (it is writable) and restores the original after each
// test rather than using vi.stubGlobal (which redefines and throws).
const originalMatchMedia = window.matchMedia;

/** Point `prefers-reduced-motion` at a fixed answer for one test. */
function mockReducedMotion(matches: boolean) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query.includes("prefers-reduced-motion") ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("LangyDeclarativeCard", () => {
  describe("given a collection read (rows widget)", () => {
    const output = JSON.stringify({
      data: [
        { id: "eval_1", name: "Faithfulness", status: "enabled" },
        { id: "eval_2", name: "Toxicity" },
        { id: "eval_3", name: "PII leak" },
        { id: "eval_4", name: "Latency budget" },
        { id: "eval_5", name: "Answer relevancy" },
        { id: "eval_6", name: "Conciseness" },
      ],
      pagination: { total: 9 },
    });

    describe("when the card renders", () => {
      it("titles the card with the honest total and lists the rows", () => {
        renderCard({ name: "langwatch.evaluator.list", output });

        expect(screen.getByText("9 evaluators")).toBeTruthy();
        expect(screen.getByText("Faithfulness")).toBeTruthy();
      });

      it("caps the list and says how many more there are", () => {
        renderCard({ name: "langwatch.evaluator.list", output });

        expect(screen.queryByText("Conciseness")).toBeNull();
        expect(screen.getByText("+4 more")).toBeTruthy();
      });

      it("links each row to its resource when the surface has one", () => {
        renderCard({ name: "langwatch.evaluator.list", output });

        const row = screen.getByText("Faithfulness").closest("a");
        expect(row?.getAttribute("href")).toBe(
          "/acme/evaluators?drawer.open=evaluatorViewer&drawer.evaluatorId=eval_1",
        );
      });
    });
  });

  describe("given a collection read that matched nothing", () => {
    describe("when the card renders", () => {
      it("says there are none — a real answer, not a failure", () => {
        renderCard({
          name: "langwatch.evaluator.list",
          output: JSON.stringify({ data: [] }),
        });

        expect(screen.getByText("No evaluators yet.")).toBeTruthy();
        expect(screen.queryByText(/Couldn.t read/)).toBeNull();
      });
    });
  });

  describe("given a single-resource read (facts widget)", () => {
    describe("when the card renders", () => {
      it("shows the resource's fields as a label-value grid", () => {
        renderCard({
          name: "langwatch.evaluator.get",
          output: JSON.stringify({
            id: "eval_1",
            name: "Faithfulness",
            status: "enabled",
            updatedAt: "2026-07-01",
          }),
        });

        expect(screen.getByText("Faithfulness")).toBeTruthy();
        expect(screen.getByText("status")).toBeTruthy();
        expect(screen.getByText("enabled")).toBeTruthy();
        expect(screen.getByText("updated at")).toBeTruthy();
      });
    });
  });

  describe("given a result with figures (stats widget)", () => {
    const output = JSON.stringify({ last24h: 128, last7d: 900 });

    describe("when the reader prefers reduced motion", () => {
      it("shows the final figures with no animation", () => {
        mockReducedMotion(true);
        renderCard({ name: "langwatch.ingest.health", output });

        expect(screen.getByText("128")).toBeTruthy();
        expect(screen.getByText("900")).toBeTruthy();
      });
    });

    describe("when the card renders", () => {
      it("labels each figure from the result's own fields", () => {
        mockReducedMotion(true);
        renderCard({ name: "langwatch.ingest.health", output });

        expect(screen.getByText("last24h")).toBeTruthy();
        expect(screen.getByText("last7d")).toBeTruthy();
      });
    });
  });

  describe("given a prompt push (diff widget)", () => {
    describe("when the result names what changed", () => {
      it("shows the prompt, its new version, and the changed fields", () => {
        renderCard({
          name: "langwatch.prompt.push",
          output: JSON.stringify({
            name: "support-agent",
            version: 4,
            changes: { temperature: { from: 0.2, to: 0.7 }, messages: {} },
          }),
        });

        expect(screen.getByText("support-agent")).toBeTruthy();
        expect(screen.getByText("Version 4")).toBeTruthy();
        expect(screen.getByText("temperature")).toBeTruthy();
        expect(screen.getByText("messages")).toBeTruthy();
      });
    });
  });

  describe("given a settled write", () => {
    describe("when a resource was created", () => {
      it("renders the created card with the saved name", () => {
        renderCard({
          name: "langwatch.trigger.create",
          input: { name: "Alert on errors" },
          output: "Created trigger Alert on errors",
        });

        expect(screen.getByText("New trigger")).toBeTruthy();
        expect(screen.getByText("Alert on errors")).toBeTruthy();
        expect(screen.getByText("Created and ready to use.")).toBeTruthy();
      });
    });

    // A create that never happened returns nothing at all. Whether such a call
    // reaches a card at all is `hasCapabilityCard`'s decision, and the answer is
    // no — see capabilityCardSelection.unit.test.ts.

    describe("when a create returned the resource it created", () => {
      it("renders the created card", () => {
        renderCard({
          name: "langwatch.scenario.create",
          input: { name: "Customer support agent" },
          output: { id: "scenario_1", name: "Customer support agent" },
        });

        expect(screen.getByText("Created and ready to use.")).toBeTruthy();
      });
    });

    describe("when a resource was removed", () => {
      it("renders the removed card", () => {
        renderCard({
          name: "langwatch.trigger.delete",
          input: { id: "trigger_1" },
          output: "Deleted",
        });

        expect(screen.getByText("Delete trigger")).toBeTruthy();
        expect(screen.getByText("Removed.")).toBeTruthy();
      });
    });
  });

  describe("given a resource the catalog has never heard of", () => {
    describe("when the card renders", () => {
      it("still shows a readable card worded from the command", () => {
        renderCard({
          name: "langwatch.flux-capacitor.list",
          output: JSON.stringify({
            data: [{ id: "fc_1", name: "Prototype" }],
          }),
        });

        expect(screen.getByText("Flux capacitors")).toBeTruthy();
        expect(screen.getByText("Prototype")).toBeTruthy();
      });

      it("offers no link rather than a broken one", () => {
        renderCard({
          name: "langwatch.flux-capacitor.list",
          output: JSON.stringify({ data: [] }),
        });

        expect(screen.queryByText(/Open in/)).toBeNull();
      });
    });
  });

  describe("given output the card cannot read", () => {
    // Truncated JSON: looks like a document, parses as nothing.
    const truncated = '{"data":[{"id":"eval_1","name":"Fai';

    describe("when the card renders", () => {
      it("owns the failure instead of inventing an empty result", () => {
        renderCard({ name: "langwatch.evaluator.list", output: truncated });

        expect(screen.getByText(/Couldn.t read this result/)).toBeTruthy();
        expect(screen.queryByText("No evaluators yet.")).toBeNull();
      });

      it("still offers the way into the surface", () => {
        renderCard({ name: "langwatch.evaluator.list", output: truncated });

        expect(screen.getByText(/Open in Evaluators/)).toBeTruthy();
      });
    });
  });

  describe("given plain console output that is not a document", () => {
    describe("when the card renders", () => {
      it("shows the output's own lines (text fallback)", () => {
        renderCard({
          name: "langwatch.governance.status",
          output: "Governance is set up\nAll ingestion sources healthy",
        });

        expect(screen.getByText("Governance is set up")).toBeTruthy();
        expect(screen.getByText("All ingestion sources healthy")).toBeTruthy();
      });
    });
  });

  describe("given a collection read whose references hydrate fresh data", () => {
    const digest: CliResultDigest = {
      resource: "prompt",
      verb: "list",
      strategy: "id-ref",
      ids: ["prompt_1", "prompt_2"],
      counts: { returned: 2, total: 7 },
    };

    const renderHydrated = () => {
      const descriptor = resolveCapability("langwatch.prompt.list")!;
      return render(
        <ChakraProvider value={defaultSystem}>
          <LangyDeclarativeCard
            descriptor={descriptor}
            input={{}}
            output=""
            digest={digest}
            projectSlug="acme"
          />
        </ChakraProvider>,
      );
    };

    describe("when the hydrated rows arrive", () => {
      it("renders the current names with the digest's honest counts", () => {
        useCapabilityDataMock.mockReturnValue({
          status: "hydrated",
          rows: [
            { id: "prompt_1", primary: "support/greeting" },
            { id: "prompt_2", primary: "support/refund" },
          ],
          loadedCount: 2,
          totalCount: 7,
          isHydrating: false,
        });
        renderHydrated();

        expect(screen.getByText("7 prompts")).toBeTruthy();
        expect(screen.getByText("support/greeting")).toBeTruthy();
        expect(screen.getByText("+5 more")).toBeTruthy();
      });
    });

    describe("when none of the referenced prompts exist any more", () => {
      it("says so honestly instead of inventing an empty list", () => {
        useCapabilityDataMock.mockReturnValue({
          status: "hydrated",
          rows: [],
          loadedCount: 0,
          totalCount: 7,
          isHydrating: false,
        });
        renderHydrated();

        expect(
          screen.getByText("These prompts are no longer available."),
        ).toBeTruthy();
        expect(screen.queryByText("No prompts yet.")).toBeNull();
      });
    });
  });
});

/**
 * The body widget the catalog names, when that widget is not one this card had
 * a branch for. `chart` was registered in the catalog's vocabulary and had no
 * case and no default, so the switch fell off the end and the card rendered
 * `undefined` — a shell with nothing in it.
 */
describe("given a body widget the catalog names", () => {
  /** The same descriptor the call resolves to, re-seated on one widget. */
  function renderWithBody({ body, output }: { body: string; output: unknown }) {
    const descriptor = resolveCapability("langwatch.analytics.query");
    if (!descriptor) throw new Error("no descriptor for analytics query");
    return render(
      <ChakraProvider value={defaultSystem}>
        <LangyDeclarativeCard
          descriptor={
            { ...descriptor, body } as unknown as typeof descriptor
          }
          input={{}}
          output={output}
          projectSlug="acme"
        />
      </ChakraProvider>,
    );
  }

  const trend = {
    series: [
      {
        name: "Total cost",
        points: [
          { t: "2026-07-13", v: 0.11 },
          { t: "2026-07-14", v: 0.28 },
        ],
      },
    ],
    title: "Total cost",
    unit: "usd",
    currentPeriod: [],
  };

  describe("when the widget is a chart and the result is plottable", () => {
    it("draws the plot", () => {
      renderWithBody({ body: "chart", output: trend });

      expect(document.querySelector(".recharts-surface")).not.toBeNull();
    });
  });

  describe("when the widget is a chart and the result has nothing to plot", () => {
    it("reads the figures instead of drawing an empty axis", () => {
      renderWithBody({
        body: "chart",
        output: { currentPeriod: [], total: 4, failures: 1 },
      });

      expect(document.querySelector(".recharts-surface")).toBeNull();
      expect(screen.getByText("total")).toBeTruthy();
    });
  });

  describe("when the widget is one this card has never heard of", () => {
    it("still draws a body rather than an empty card", () => {
      renderWithBody({
        body: "constellation",
        output: { currentPeriod: [], name: "Total cost", status: "ready" },
      });

      expect(screen.getByText("status")).toBeTruthy();
      expect(screen.getByText("ready")).toBeTruthy();
    });
  });
});
