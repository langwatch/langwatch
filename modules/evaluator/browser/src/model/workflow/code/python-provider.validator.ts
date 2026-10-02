import type { Monaco } from "@monaco-editor/react";
import type { editor, IDisposable } from "monaco-editor";

import {
  type ContractRef,
  findLastReturnDict,
  literalKindFor,
  literalKindOf,
  MISSING_CALL_CODE,
  MISSING_CLASS_CODE,
  MISSING_OUTPUT_KEY,
  MIXED_INDENT,
  OUTPUT_TYPE_MISMATCH,
  parseSimpleDictEntries,
} from "./python-provider.shared.ts";

export interface ValidatorHandle extends IDisposable {
  revalidate: () => void;
}
type Delimiter = '"' | "'" | '"""' | "'''";
type State = {
  inString: Delimiter | false;
  markers: editor.IMarkerData[];
  stack: { ch: string; line: number; col: number }[];
};
const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function isTripleQuote(value: string | false): value is '"""' | "'''" {
  return value === '"""' || value === "'''";
}
function addError({
  state,
  monaco,
  message,
  line,
  col,
}: {
  state: State;
  monaco: Monaco;
  message: string;
  line: number;
  col: number;
}): void {
  state.markers.push({
    severity: monaco.MarkerSeverity.Error,
    message,
    startLineNumber: line + 1,
    startColumn: col + 1,
    endLineNumber: line + 1,
    endColumn: col + 2,
  });
}
function scanString(state: State, line: string, col: number): number {
  const delimiter = state.inString;
  if (isTripleQuote(delimiter) && line.slice(col, col + 3) === delimiter) {
    state.inString = false;
    return col + 3;
  }
  if ((delimiter === '"' || delimiter === "'") && line[col] === delimiter) {
    state.inString = false;
    return col + 1;
  }
  return col + (line[col] === "\\" ? 2 : 1);
}
function scanBracket({
  state,
  monaco,
  ch,
  line,
  col,
}: {
  state: State;
  monaco: Monaco;
  ch: string;
  line: number;
  col: number;
}): void {
  if (ch === "(" || ch === "[" || ch === "{") {
    state.stack.push({ ch, line, col });
    return;
  }
  const expected = pairs[ch];
  if (!expected) return;
  const top = state.stack[state.stack.length - 1];
  if (!top || top.ch !== expected) {
    addError({ state, monaco, message: `Unmatched closing '${ch}'`, line, col });
    return;
  }
  state.stack.pop();
}
function scanSyntaxLine({
  state,
  monaco,
  line,
  lineIndex,
}: {
  state: State;
  monaco: Monaco;
  line: string;
  lineIndex: number;
}): void {
  let col = 0;
  while (col < line.length) {
    if (state.inString) {
      col = scanString(state, line, col);
      continue;
    }
    const ch = line[col] ?? "";
    const nextThree = line.slice(col, col + 3);
    if (ch === "#") break;
    if (isTripleQuote(nextThree)) {
      state.inString = nextThree;
      col += 3;
      continue;
    }
    if (ch === '"' || ch === "'") {
      state.inString = ch;
      col += 1;
      continue;
    }
    scanBracket({ state, monaco, ch, line: lineIndex, col });
    col += 1;
  }
}
function checkLine({
  state,
  monaco,
  line,
  lineIndex,
}: {
  state: State;
  monaco: Monaco;
  line: string;
  lineIndex: number;
}): void {
  if (state.inString === '"' || state.inString === "'") {
    state.markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: "Unterminated string literal",
      startLineNumber: lineIndex + 1,
      startColumn: 1,
      endLineNumber: lineIndex + 1,
      endColumn: line.length + 1,
    });
    state.inString = false;
  }
  const indent = /^([ \t]+)/.exec(line)?.[1];
  if (!indent || !/\t/.test(indent) || !/ /.test(indent)) return;
  state.markers.push({
    severity: monaco.MarkerSeverity.Warning,
    code: MIXED_INDENT,
    message: "Mixed tabs and spaces in indentation",
    startLineNumber: lineIndex + 1,
    startColumn: 1,
    endLineNumber: lineIndex + 1,
    endColumn: indent.length + 1,
  });
}
function scanPythonSyntax(lines: string[], monaco: Monaco): editor.IMarkerData[] {
  const state: State = { inString: false, markers: [], stack: [] };
  for (const [index, line] of lines.entries()) {
    scanSyntaxLine({ state, monaco, line, lineIndex: index });
    checkLine({ state, monaco, line, lineIndex: index });
  }
  if (isTripleQuote(state.inString)) {
    const lastLine = lines.length - 1;
    state.markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: "Unterminated triple-quoted string",
      startLineNumber: lines.length,
      startColumn: 1,
      endLineNumber: lines.length,
      endColumn: (lines[lastLine]?.length ?? 0) + 1,
    });
  }
  for (const open of state.stack)
    addError({ state, monaco, message: `Unclosed '${open.ch}'`, line: open.line, col: open.col });
  return state.markers;
}
function addScaffoldMarkers(markers: editor.IMarkerData[], monaco: Monaco, source: string): void {
  const missingClass = !/\bclass\s+Code\b/.test(source);
  const missingCall = !/\bdef\s+__call__\s*\(/.test(source);
  if (!missingClass && !missingCall) return;
  markers.push({
    severity: monaco.MarkerSeverity.Error,
    code: missingClass ? MISSING_CLASS_CODE : MISSING_CALL_CODE,
    message: missingClass
      ? "Missing `class Code:` declaration — the workflow runtime calls `Code().__call__(input)`. Add it back so the node can execute."
      : "Missing `def __call__(self, input: str):` on `class Code` — the workflow runtime invokes it to run the node.",
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 2,
  });
}
function addOutputMarkers({
  markers,
  monaco,
  source,
  contractRef,
}: {
  markers: editor.IMarkerData[];
  monaco: Monaco;
  source: string;
  contractRef: ContractRef;
}): void {
  for (const field of contractRef.current.outputs) {
    const escaped = field.identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`['"]${escaped}['"]`).test(source)) continue;
    markers.push({
      severity: monaco.MarkerSeverity.Warning,
      code: `${MISSING_OUTPUT_KEY}:${field.identifier}`,
      message: `Declared output "${field.identifier}" (${field.type}) is never set — make sure your return dict includes it.`,
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 2,
    });
  }
}
function addTypeMarkers({
  markers,
  monaco,
  model,
  contractRef,
}: {
  markers: editor.IMarkerData[];
  monaco: Monaco;
  model: editor.ITextModel;
  contractRef: ContractRef;
}): void {
  const result = findLastReturnDict(model.getValue());
  if (!result) return;
  for (const entry of parseSimpleDictEntries(result.body)) {
    const declared = contractRef.current.outputs.find((output) => output.identifier === entry.key);
    if (!declared) continue;
    const expected = literalKindFor(declared.type);
    const actual = literalKindOf(entry.value);
    if (!actual || !expected || actual === expected) continue;
    const start = model.getPositionAt(result.bodyStart + entry.valueOffset);
    const end = model.getPositionAt(result.bodyStart + entry.valueOffset + entry.value.length);
    markers.push({
      severity: monaco.MarkerSeverity.Warning,
      code: `${OUTPUT_TYPE_MISMATCH}:${entry.key}`,
      message: `Declared output "${entry.key}" expects ${declared.type} but the return value looks like ${actual}.`,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    });
  }
}
function validateModel({
  monaco,
  contractRef,
  owner,
  model,
}: {
  monaco: Monaco;
  contractRef: ContractRef;
  owner: string;
  model: editor.ITextModel;
}): void {
  if (model.getLanguageId() !== "python") return;
  const source = model.getValue();
  const markers = scanPythonSyntax(source.split("\n"), monaco);
  addScaffoldMarkers(markers, monaco, source);
  addOutputMarkers({ markers, monaco, source, contractRef });
  addTypeMarkers({ markers, monaco, model, contractRef });
  monaco.editor.setModelMarkers(model, owner, markers);
}
function watchModel(
  model: editor.ITextModel,
  validate: (model: editor.ITextModel) => void,
  disposers: IDisposable[],
): void {
  validate(model);
  disposers.push(model.onDidChangeContent(() => validate(model)));
}
export function registerValidator(monaco: Monaco, contractRef: ContractRef): ValidatorHandle {
  const owner = "langwatch-python-lint";
  const disposers: IDisposable[] = [];
  const validate = (model: editor.ITextModel) =>
    validateModel({ monaco, contractRef, owner, model });
  const created = monaco.editor.onDidCreateModel((model: editor.ITextModel) =>
    watchModel(model, validate, disposers),
  );
  for (const model of monaco.editor.getModels()) watchModel(model, validate, disposers);
  return {
    dispose: () => {
      created.dispose();
      for (const disposer of disposers) disposer.dispose();
      for (const model of monaco.editor.getModels())
        monaco.editor.setModelMarkers(model, owner, []);
    },
    revalidate: () => {
      for (const model of monaco.editor.getModels()) validate(model);
    },
  };
}
