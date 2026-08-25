/**
 * @vitest-environment jsdom
 *
 * The editor's assistance is the schema response and nothing else: this test
 * passes refusal markers in and verifies they map to the Monaco markers the
 * editor registers.
 *
 * Monaco is replaced by a stub at the module boundary: the assertions are about
 * what the workbench registers and hands to it, which is ours, not about what
 * Monaco does with it, which is not.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LangWatchQLEditor } from "../components/LangWatchQLEditor";
import { LWQL_LANGUAGE_ITEMS } from "../logic/lwqlLanguageItems";
import { lwqlSchemaModel } from "../logic/lwqlSchemaModel";
import {
  SCHEMA_AVAILABLE_COLUMN_NAMES,
  SCHEMA_DATASET_NAMES,
  SCHEMA_RESPONSE,
} from "./lwqlFixtures";

interface CompletionProvider {
  provideCompletionItems: (
    model: unknown,
    position: unknown,
  ) => {
    suggestions: {
      label: string;
      detail: string;
      documentation: string;
      insertText: string;
      sortText?: string;
    }[];
  };
}

interface HoverProvider {
  provideHover: (
    model: unknown,
    position: unknown,
  ) => { contents: { value: string }[] } | null;
}

const harness = vi.hoisted(() => {
  const slots: {
    mounted: boolean;
    completion: unknown;
    hover: unknown;
    markers: unknown[];
    disposed: string[];
  } = {
    mounted: false,
    completion: null,
    hover: null,
    markers: [],
    disposed: [],
  };

  const monaco = {
    MarkerSeverity: { Error: 8 },
    editor: {
      setModelMarkers: (_model: unknown, _owner: string, markers: unknown[]) => {
        slots.markers = markers;
      },
    },
    languages: {
      CompletionItemKind: { Struct: 1, Field: 2, Keyword: 3, Function: 4 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: (_language: string, provider: unknown) => {
        slots.completion = provider;
        return { dispose: () => slots.disposed.push("completion") };
      },
      registerHoverProvider: (_language: string, provider: unknown) => {
        slots.hover = provider;
        return { dispose: () => slots.disposed.push("hover") };
      },
    },
  };

  const model = {
    getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    getWordAtPosition: () => ({ word: "latency_ms" }),
  };

  const editor = {
    getModel: () => model,
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    executeEdits: (_source: string, _edits: unknown[]) => undefined,
    focus: () => undefined,
  };

  return { slots, monaco, editor, model };
});

// The editor reaches Monaco through the code-splitting shim, and that lazy
// boundary never resolves under jsdom — the component sits on its loading
// fallback forever. Standing the stub in for the shim's result mounts it
// synchronously and leaves the real `LangWatchQLEditor`, which is what these
// assertions are about, entirely untouched.
//
// Mount is announced during render rather than from an effect, and guarded by
// a flag: a second announcement would register a second provider, which is
// precisely the leak this stub must not paper over.
vi.mock("~/utils/compat/next-dynamic", () => {
  function StubMonacoEditor(props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) {
    if (!harness.slots.mounted) {
      harness.slots.mounted = true;
      props.onMount?.(harness.editor, harness.monaco);
    }
    return (
      <textarea
        data-testid="stub-monaco"
        aria-label="LangWatchQL ClickHouse SQL"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }

  return { __esModule: true, default: () => StubMonacoEditor };
});

const SCHEMA_MODEL = lwqlSchemaModel(SCHEMA_RESPONSE);

beforeEach(() => {
  harness.slots.mounted = false;
  harness.slots.completion = null;
  harness.slots.hover = null;
  harness.slots.markers = [];
  harness.slots.disposed = [];
});

async function renderEditor({
  markers = [],
}: {
  markers?: readonly { line: number; column: number; message: string }[];
} = {}) {
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <LangWatchQLEditor
        sql="SELECT latency_ms FROM analytics.traces_daily"
        onChange={vi.fn()}
        schema={SCHEMA_MODEL}
        markers={markers}
      />
    </ChakraProvider>,
  );
  await screen.findByTestId("stub-monaco");
  return view;
}

describe("the LangWatchQL editor", () => {
  describe("given the schema endpoint answered for this member", () => {
    describe("when the member invokes completion or hovers an identifier", () => {
      /** @scenario "Monaco assistance derives from the same schema response" */
      it("offers the schema the response carried, plus the SQL language and nothing else", async () => {
        await renderEditor();

        const completion = harness.slots.completion as CompletionProvider;
        const { suggestions } = completion.provideCompletionItems(harness.model, {
          lineNumber: 1,
          column: 1,
        });

        // Every identifier is the response's own; the only additions are the
        // static keyword and function lists, which name no dataset or column.
        expect(suggestions.map((item) => item.label).sort()).toEqual(
          [
            ...SCHEMA_DATASET_NAMES,
            ...SCHEMA_AVAILABLE_COLUMN_NAMES,
            ...LWQL_LANGUAGE_ITEMS.map((item) => item.label),
          ].sort(),
        );
        expect(suggestions.find((item) => item.label === "latency_ms")?.detail).toBe(
          "Float64",
        );
      });

      /** @scenario "Typing a keyword offers the keyword" */
      it("offers SELECT to a member who has typed nothing schema-shaped", async () => {
        await renderEditor();

        const completion = harness.slots.completion as CompletionProvider;
        const { suggestions } = completion.provideCompletionItems(harness.model, {
          lineNumber: 1,
          column: 1,
        });

        const select = suggestions.find((item) => item.label === "SELECT");
        expect(select?.insertText).toBe("SELECT");
        // Keywords sort ahead of identifiers on an equal fuzzy match, so
        // typing "sel" surfaces SELECT before a column starting with the same
        // letters.
        expect(select?.sortText).toBe("0 SELECT");
      });

      /** @scenario "Monaco assistance derives from the same schema response" */
      it("answers a hover with that column's own type and description", async () => {
        await renderEditor();

        const hover = harness.slots.hover as HoverProvider;
        const answer = hover.provideHover(harness.model, {
          lineNumber: 1,
          column: 8,
        });

        const text = (answer?.contents ?? []).map((entry) => entry.value).join("\n");
        expect(text).toContain("analytics.traces_daily.latency_ms");
        expect(text).toContain("Float64");
        expect(text).toContain("End to end latency of the trace.");
      });
    });

    describe("when a refusal names a line and column", () => {
      /** @scenario "A statement the validator cannot parse renders registry copy at its location" */
      it("marks that position in the editor", async () => {
        await renderEditor({
          markers: [
            {
              line: 3,
              column: 12,
              message: "The statement could not be parsed.",
            },
          ],
        });

        expect(harness.slots.markers).toEqual([
          {
            severity: 8,
            message: "The statement could not be parsed.",
            startLineNumber: 3,
            startColumn: 12,
            endLineNumber: 3,
            endColumn: 13,
          },
        ]);
      });
    });
  });
});
