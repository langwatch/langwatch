/**
 * A jsdom stand-in for `@monaco-editor/react`: a plain textarea behind the slice of the editor and
 * Monaco APIs the braid condition field calls, recording the completion provider and markers.
 */

import { useRef } from "react";
import { vi } from "vitest";

type Marker = { message: string; startColumn: number; endColumn: number };

export const monacoRecorded: {
  provider?: { provideCompletionItems: (model: unknown, position: unknown) => unknown };
  /** The last mounted editor's model, to ask the provider about. */
  model?: unknown;
  markers: Marker[];
  themes: string[];
} = { markers: [], themes: [] };

function fakeMonaco() {
  return {
    languages: {
      CompletionItemKind: { Field: 3, Operator: 11, Snippet: 27, Keyword: 17 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      registerCompletionItemProvider: (_id: string, provider: typeof monacoRecorded.provider) => {
        monacoRecorded.provider = provider;
      },
    },
    editor: {
      defineTheme: (name: string) => monacoRecorded.themes.push(name),
      setTheme: vi.fn(),
      setModelMarkers: (_model: unknown, _owner: string, markers: Marker[]) => {
        monacoRecorded.markers = markers;
      },
    },
    MarkerSeverity: { Error: 8 },
  };
}

type FakeEditorProps = {
  path: string;
  defaultValue: string;
  onChange: (value: string | undefined) => void;
  beforeMount: (monaco: unknown) => void;
  onMount: (editor: unknown, monaco: unknown) => void;
  options: { ariaLabel?: string };
  wrapperProps?: Record<string, string>;
};

function FakeMonacoEditor(props: FakeEditorProps) {
  const mountedOnce = useRef(false);
  const attach = (element: HTMLTextAreaElement | null) => {
    if (!element || mountedOnce.current) return;
    mountedOnce.current = true;
    const monaco = fakeMonaco();
    const model = {
      uri: { toString: () => props.path },
      getValue: () => element.value,
      getOffsetAt: (position: { column: number }) => position.column - 1,
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    };
    monacoRecorded.model = model;
    props.beforeMount(monaco);
    props.onMount(
      {
        getModel: () => model,
        getValue: () => element.value,
        setValue: (value: string) => {
          element.value = value;
        },
        hasTextFocus: () => document.activeElement === element,
        focus: () => element.focus(),
        getContentHeight: () => 32,
        onDidContentSizeChange: vi.fn(),
        onDidBlurEditorText: (listener: () => void) => element.addEventListener("blur", listener),
      },
      monaco,
    );
  };
  return (
    <textarea
      ref={attach}
      {...props.wrapperProps}
      aria-label={props.options.ariaLabel}
      defaultValue={props.defaultValue}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

export default FakeMonacoEditor;
