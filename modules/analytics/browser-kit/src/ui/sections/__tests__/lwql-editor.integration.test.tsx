/**
 * @vitest-environment jsdom
 * Monaco does not run under jsdom, so it is replaced by a stand-in that hands the editor a
 * recording Monaco. The schema read is mocked so it can fail.
 * @see modules/analytics/specs/analytics-lwql-editor.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { LangWatchQLSchema } from "@langwatch/analytics-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SCHEMA } from "../../../model/lwql-language/__tests__/lwql-fixture.fixture.ts";

type Suggestions = { suggestions: { label: string }[] };
type Provider = { provideCompletionItems: (model: FakeModel, position: unknown) => Suggestions };
type Marker = { message: string; startLineNumber: number; startColumn: number };

type Recorded = {
  provider: Provider | undefined;
  markers: unknown[];
  mounted: FakeModel | undefined;
};

const recorded = vi.hoisted((): Recorded => ({
  provider: undefined,
  markers: [],
  mounted: undefined,
}));

class FakeModel {
  readonly uri = { toString: () => "inmemory://lwql/test.lwql" };
  constructor(private text: string) {}
  getValue = () => this.text;
  getOffsetAt = () => this.text.length;
  getPositionAt = (offset: number) => ({ lineNumber: 1, column: offset + 1 });
  getWordAtPosition = () => null;
}

function fakeMonaco() {
  const kinds = new Proxy({}, { get: (_target, key) => String(key) });
  return {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
    languages: {
      CompletionItemKind: kinds,
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemTag: { Deprecated: 1 },
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      registerHoverProvider: vi.fn(),
      registerCompletionItemProvider: (_id: string, provider: Provider) => {
        recorded.provider = provider;
      },
    },
    editor: {
      setModelMarkers: (_model: unknown, _owner: string, markers: unknown[]) => {
        recorded.markers = markers;
      },
    },
  };
}

vi.mock("@monaco-editor/react", () => ({
  default: (props: {
    value: string;
    beforeMount: (monaco: unknown) => void;
    onMount: (editor: unknown, monaco: unknown) => void;
    options: { readOnly?: boolean };
  }) => {
    const mountedOnce = useRef(false);
    const attach = (element: HTMLTextAreaElement | null) => {
      if (!element || mountedOnce.current) return;
      mountedOnce.current = true;
      const monaco = fakeMonaco();
      const model = new FakeModel(props.value);
      props.beforeMount(monaco);
      recorded.mounted = model;
      props.onMount(
        { getModel: () => model, createDecorationsCollection: () => ({ set: vi.fn() }) },
        monaco,
      );
    };
    return (
      <textarea
        ref={attach}
        data-testid="lwql-input"
        defaultValue={props.value}
        readOnly={props.options.readOnly}
      />
    );
  },
}));

import { LwqlEditor } from "../lwql-editor.tsx";

function mount({
  schema,
  value = "SEL",
  markers,
}: {
  schema?: LangWatchQLSchema;
  value?: string;
  markers?: Marker[];
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LwqlEditor
        schema={schema}
        value={value}
        onChange={vi.fn()}
        markers={markers?.map((m) => ({
          message: m.message,
          line: m.startLineNumber,
          column: m.startColumn,
        }))}
      />
    </ChakraProvider>,
  );
}

function completionLabels(): string[] {
  const { provider, mounted } = recorded;
  if (!provider || !mounted) throw new Error("the editor has not mounted yet");
  return provider.provideCompletionItems(mounted, {}).suggestions.map((s) => s.label);
}

describe("LwqlEditor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given an editor given a schema", () => {
    describe("when the editor loads", () => {
      /** @scenario "The editor completes against the schema its host gives it" */
      it("offers completion against that schema", async () => {
        mount({ schema: SCHEMA, value: "SELECT 1 FROM " });
        await screen.findByTestId("lwql-input");
        await waitFor(() =>
          expect(completionLabels()).toEqual(["analytics.traces", "analytics.spans"]),
        );
      });
    });
  });

  describe("given an editor given no schema because it is loading or the read failed", () => {
    describe("when the editor is mounted and the member asks for completion", () => {
      /** @scenario "A missing schema leaves a working editor that still completes keywords" */
      it("stays editable and offers keywords", async () => {
        mount({ value: "SEL" });
        const input = await screen.findByTestId("lwql-input");
        expect(input.hasAttribute("readonly")).toBe(false);
        await waitFor(() => {
          expect(completionLabels()).toContain("SELECT");
          expect(completionLabels()).not.toContain("count");
        });
      });
    });
  });

  describe("given an editor given a marker at a line and column", () => {
    describe("when the editor is mounted", () => {
      /** @scenario "Markers the host passes are drawn at their position" */
      it("carries the marker with its message and position", async () => {
        mount({
          schema: SCHEMA,
          markers: [{ message: "Not allowed", startLineNumber: 1, startColumn: 8 }],
        });
        await screen.findByTestId("lwql-input");
        await waitFor(() =>
          expect(recorded.markers).toEqual([
            expect.objectContaining({ message: "Not allowed", startLineNumber: 1, startColumn: 8 }),
          ]),
        );
      });
    });
  });
});
