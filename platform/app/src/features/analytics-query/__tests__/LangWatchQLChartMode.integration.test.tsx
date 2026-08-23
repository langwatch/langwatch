/**
 * @vitest-environment jsdom
 *
 * Chart mode as a member uses it: a starting specification, an editor that
 * answers every keystroke, and a chart that redraws — with the database never
 * asked anything and nothing written down anywhere.
 *
 * Monaco and `vega-embed` are both replaced at the module boundary. What is
 * under test is what this surface does with an edit, which is ours.
 *
 * Spec: specs/analytics/lwql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LangWatchQLChartMode,
  type LangWatchQLChartResult,
} from "../components/LangWatchQLChartMode";
import type { LangWatchQLDatasetColumn } from "../visualization/visualization.types";

const vega = vi.hoisted(() => {
  const state = { embeds: 0, data: [] as { name: string; rows: unknown[] }[] };
  const view = {
    data: (name: string, rows: unknown[]) => {
      state.data.push({ name, rows });
      return view;
    },
    runAsync: () => Promise.resolve(view),
    resize: () => view,
  };
  const embed = (
    _element: unknown,
    spec: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => {
    state.embeds += 1;
    return Promise.resolve({
      view,
      spec,
      vgSpec: {},
      embedOptions: options,
      finalize: () => undefined,
    });
  };
  return { state, embed };
});

vi.mock("vega-embed", () => ({ default: vega.embed }));

// The editor reaches Monaco through the code-splitting shim, and that lazy
// boundary never resolves under jsdom — the panel sits on its loading fallback
// forever. Standing a textarea in for the shim's result mounts it synchronously
// and leaves the real `VegaLiteSpecEditor` untouched, which is what these
// assertions are about. (Same treatment, same reason, as
// `LangWatchQLEditor.integration.test.tsx`.)
vi.mock("~/utils/compat/next-dynamic", () => {
  function StubSpecEditor(props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
  }) {
    return (
      <textarea
        data-testid="spec-editor-input"
        aria-label="Chart specification"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }

  return { __esModule: true, default: () => StubSpecEditor };
});

const COLUMNS: readonly LangWatchQLDatasetColumn[] = [
  { name: "model", type: "String" },
  { name: "total", type: "UInt64" },
];

const RESULT = {
  columns: COLUMNS,
  rows: [
    { model: "gpt-5-mini", total: 3 },
    { model: "claude", total: 5 },
  ],
};

/**
 * The owner's half of the specification state, which in the product is the
 * workbench. Chart mode never holds the text itself — a refused query unmounts
 * it — so anything exercising an edit has to supply the half that does.
 */
function ChartModeHost({
  result = RESULT,
  view,
  submittedLabel,
}: {
  result?: LangWatchQLChartResult;
  view?: "chart" | "specification";
  submittedLabel?: string;
}) {
  const [editedSpecText, setEditedSpecText] = useState<string | null>(null);

  return (
    <LangWatchQLChartMode
      result={result}
      {...(view ? { view } : {})}
      {...(submittedLabel ? { submittedLabel } : {})}
      editedSpecText={editedSpecText}
      onEditedSpecTextChange={setEditedSpecText}
    />
  );
}

const withChakra = (element: ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);

/**
 * Re-renders the same mounted host with a different view, the way the result
 * pane's tabs do. Same element type in the same position, so the specification
 * state survives the switch — which is the point of the shared component.
 */
const switchView = (
  rerender: (element: ReactElement) => void,
  view: "chart" | "specification",
  rest: { result?: LangWatchQLChartResult; submittedLabel?: string } = {},
) => {
  rerender(
    <ChakraProvider value={defaultSystem}>
      <ChartModeHost view={view} {...rest} />
    </ChakraProvider>,
  );
};

const findEditor = () => screen.findByTestId("spec-editor-input");

/** Replaces the whole buffer, the way pasting a specification does. */
const replaceSpec = async (editor: HTMLElement, text: string) => {
  await userEvent.clear(editor);
  await userEvent.paste(text);
};

let requests: string[] = [];
let stored: string[] = [];

beforeEach(() => {
  vega.state.embeds = 0;
  vega.state.data = [];
  requests = [];
  stored = [];

  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown) => {
      requests.push(String(input));
      return Promise.reject(new Error("no request may leave this surface"));
    }),
  );
  vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
    stored.push(key);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chart mode", () => {
  describe("given a successful LangWatchQL result", () => {
    describe("when chart mode opens", () => {
      it("starts from a specification that draws the result it is given", async () => {
        const { rerender } = withChakra(<ChartModeHost result={RESULT} />);

        await waitFor(() => expect(vega.state.embeds).toBe(1));
        expect(screen.queryByTestId("lwql-chart-failure")).toBeNull();

        switchView(rerender, "specification");
        const editor = await findEditor();
        const starter = JSON.parse((editor as HTMLTextAreaElement).value);
        expect(starter.data).toEqual({ name: "query_result" });
        expect(starter.encoding.x.field).toBe("model");
        expect(starter.encoding.y.field).toBe("total");
      });

      it("describes the chart by the query it came from when the pane says so", async () => {
        withChakra(<ChartModeHost result={RESULT} submittedLabel="run 4" />);

        expect(
          await screen.findByRole("img", {
            name: "Chart of the result of run 4",
          }),
        ).toBeInTheDocument();
      });
    });

    describe("when the member edits the specification", () => {
      /** @scenario "Editing the chart specification never reruns SQL" */
      it("revalidates and redraws without issuing a single request", async () => {
        const { rerender } = withChakra(<ChartModeHost result={RESULT} />);
        await waitFor(() => expect(vega.state.embeds).toBe(1));

        switchView(rerender, "specification");
        const editor = await findEditor();
        await replaceSpec(
          editor,
          JSON.stringify({
            data: { name: "query_result" },
            mark: "point",
            encoding: {
              x: { field: "model", type: "nominal" },
              y: { field: "total", type: "quantitative" },
            },
          }),
        );

        // Back on the chart, it is rebuilt for the new specification…
        switchView(rerender, "chart");
        await waitFor(() => expect(vega.state.embeds).toBe(2));
        // …and nothing asked the database anything.
        expect(requests).toEqual([]);
      });

      /** @scenario "Editing the chart specification never reruns SQL" */
      it("reports what is wrong as it is typed, and keeps reporting nothing when it is fixed", async () => {
        const { rerender } = withChakra(
          <ChartModeHost result={RESULT} view="specification" />,
        );
        const editor = await findEditor();

        await replaceSpec(editor, "{ not json");
        expect(
          (await screen.findByTestId("vega-spec-editor-problems")).textContent,
        ).toContain("not valid JSON");

        await replaceSpec(
          editor,
          JSON.stringify({
            data: { name: "query_result" },
            mark: "bar",
            encoding: { x: { field: "nowhere", type: "nominal" } },
          }),
        );

        await waitFor(() =>
          expect(
            screen.getByTestId("vega-spec-editor-problems").textContent,
          ).toContain("nowhere"),
        );

        await replaceSpec(
          editor,
          JSON.stringify({
            data: { name: "query_result" },
            mark: "bar",
            encoding: { x: { field: "model", type: "nominal" } },
          }),
        );

        await waitFor(() =>
          expect(screen.queryByTestId("vega-spec-editor-problems")).toBeNull(),
        );

        // The chart view agrees: nothing refused, the chart draws.
        switchView(rerender, "chart");
        await waitFor(() => expect(vega.state.embeds).toBe(1));
        expect(screen.queryByTestId("lwql-chart-failure")).toBeNull();
        expect(requests).toEqual([]);
      });

      /** @scenario "The workbench ships no polling, browser-side persistence, export, or agent surface" */
      it("writes the specification nowhere: it lives as long as the result is on screen", async () => {
        const { unmount } = withChakra(
          <ChartModeHost result={RESULT} view="specification" />,
        );
        const editor = await findEditor();

        await replaceSpec(
          editor,
          JSON.stringify({ data: { name: "query_result" }, mark: "point" }),
        );
        unmount();

        expect(stored).toEqual([]);
        expect(requests).toEqual([]);
      });

      it("gives the starting specification back on request", async () => {
        withChakra(<ChartModeHost result={RESULT} view="specification" />);
        const editor = await findEditor();
        const starter = (editor as HTMLTextAreaElement).value;

        await replaceSpec(editor, "{}");
        expect((editor as HTMLTextAreaElement).value).not.toBe(starter);

        await userEvent.click(screen.getByTestId("vega-spec-reset"));

        await waitFor(() =>
          expect((editor as HTMLTextAreaElement).value).toBe(starter),
        );
      });
    });

    describe("when the member reads the specification view's policy panel", () => {
      /** @scenario "The specification view names what the chart policy accepts" */
      it("says where the specification stands and what the policy accepts", async () => {
        withChakra(<ChartModeHost result={RESULT} view="specification" />);

        const panel = screen.getByTestId("vega-spec-policy-panel");
        // The starter specification is valid, and the panel says so.
        expect(panel.textContent).toContain("Valid");
        // The reference names the one dataset a specification may read.
        expect(panel.textContent).toContain("query_result");
        expect(panel.textContent).toContain("The policy accepts");

        const editor = await findEditor();
        await replaceSpec(editor, "{ not json");

        // A refusal flips the panel and names what it refers to.
        await waitFor(() =>
          expect(
            screen.getByTestId("vega-spec-policy-panel").textContent,
          ).toContain("Refused"),
        );
      });
    });

    describe("when a new query returns a result with different columns", () => {
      /** @scenario "A new result reshapes the starter specification until it is edited" */
      it("redraws from a starter specification over the new columns", async () => {
        const { rerender } = withChakra(<ChartModeHost result={RESULT} />);
        await waitFor(() => expect(vega.state.embeds).toBe(1));

        rerender(
          <ChakraProvider value={defaultSystem}>
            <ChartModeHost
              result={{
                columns: [
                  { name: "status", type: "String" },
                  { name: "latency_ms", type: "Float64" },
                ],
                rows: [{ status: "ok", latency_ms: 12.5 }],
              }}
              view="specification"
            />
          </ChakraProvider>,
        );

        const editor = await findEditor();
        const starter = JSON.parse((editor as HTMLTextAreaElement).value);
        expect(starter.encoding.x.field).toBe("status");
        expect(starter.encoding.y.field).toBe("latency_ms");
      });

      /** @scenario "A new result reshapes the starter specification until it is edited" */
      it("never replaces a specification the member has edited", async () => {
        const { rerender } = withChakra(
          <ChartModeHost result={RESULT} view="specification" />,
        );
        const editor = await findEditor();
        const edited = JSON.stringify({
          data: { name: "query_result" },
          mark: "point",
          encoding: { x: { field: "model", type: "nominal" } },
        });
        await replaceSpec(editor, edited);

        rerender(
          <ChakraProvider value={defaultSystem}>
            <ChartModeHost
              result={{
                columns: [{ name: "status", type: "String" }],
                rows: [{ status: "ok" }],
              }}
              view="specification"
            />
          </ChakraProvider>,
        );

        expect((editor as HTMLTextAreaElement).value).toBe(edited);
      });
    });

    describe("when a Reload returns different rows", () => {
      /** @scenario "A data-only Reload updates the chart through the live view" */
      it("feeds them to the running chart rather than rebuilding it", async () => {
        const { rerender } = withChakra(<ChartModeHost result={RESULT} />);
        await waitFor(() => expect(vega.state.embeds).toBe(1));

        rerender(
          <ChakraProvider value={defaultSystem}>
            <ChartModeHost
              result={{
                columns: COLUMNS,
                rows: [{ model: "gpt-5-mini", total: 41 }],
              }}
            />
          </ChakraProvider>,
        );

        await waitFor(() => expect(vega.state.data).toHaveLength(1));
        expect(vega.state.data[0]).toEqual({
          name: "query_result",
          rows: [{ model: "gpt-5-mini", total: 41 }],
        });
        expect(vega.state.embeds).toBe(1);
        expect(requests).toEqual([]);
      });
    });
  });
});
