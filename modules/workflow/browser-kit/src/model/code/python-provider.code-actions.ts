import type { Monaco } from "@monaco-editor/react";
import type { editor, IDisposable, languages, Range } from "monaco-editor";

import {
  CALL_METHOD_SNIPPET,
  CODE_SCAFFOLD_SNIPPET,
  type ContractRef,
  defaultValueLiteralFor,
  MISSING_CALL_CODE,
  MISSING_CLASS_CODE,
  MISSING_OUTPUT_KEY,
  MIXED_INDENT,
} from "./python-provider.shared.ts";

function markerCode(marker: editor.IMarkerData): string | undefined {
  return typeof marker.code === "string" ? marker.code : marker.code?.value;
}
function isQuickFixMarker(marker: editor.IMarkerData): boolean {
  const code = markerCode(marker);
  return (
    code === MISSING_CLASS_CODE ||
    code === MISSING_CALL_CODE ||
    code === MIXED_INDENT ||
    Boolean(code?.startsWith(MISSING_OUTPUT_KEY))
  );
}
function editAtEnd(model: editor.ITextModel, text: string): languages.CodeAction {
  const range = model.getFullModelRange();
  return {
    title: "Insert `class Code` scaffold",
    kind: "quickfix",
    isPreferred: true,
    edit: {
      edits: [
        {
          resource: model.uri,
          versionId: model.getVersionId(),
          textEdit: {
            range: {
              startLineNumber: range.endLineNumber,
              endLineNumber: range.endLineNumber,
              startColumn: range.endColumn,
              endColumn: range.endColumn,
            },
            text,
          },
        },
      ],
    },
  };
}
function classAction(model: editor.ITextModel, marker: editor.IMarkerData): languages.CodeAction {
  const text = model.getValue();
  const prefix = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  return { ...editAtEnd(model, prefix + CODE_SCAFFOLD_SNIPPET), diagnostics: [marker] };
}
function callAction(model: editor.ITextModel, marker: editor.IMarkerData): languages.CodeAction {
  let line = model.getLineCount();
  for (let index = 1; index <= model.getLineCount(); index++) {
    if (/\bclass\s+Code\b/.test(model.getLineContent(index))) {
      line = index + 1;
      break;
    }
  }
  return {
    title: "Insert `__call__` method",
    kind: "quickfix",
    diagnostics: [marker],
    isPreferred: true,
    edit: {
      edits: [
        {
          resource: model.uri,
          versionId: model.getVersionId(),
          textEdit: {
            range: { startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: 1 },
            text: CALL_METHOD_SNIPPET,
          },
        },
      ],
    },
  };
}
function lastReturnDict(source: string): RegExpExecArray | null {
  const expression = /(return\s*\{)([^}]*)\}/g;
  let last: RegExpExecArray | null = null;
  for (let match = expression.exec(source); match; match = expression.exec(source)) last = match;
  return last;
}
function outputAction(
  model: editor.ITextModel,
  marker: editor.IMarkerData,
  contractRef: ContractRef,
): languages.CodeAction | null {
  const code = markerCode(marker);
  if (!code) return null;
  const outputName = code.slice(MISSING_OUTPUT_KEY.length + 1);
  const outputType =
    contractRef.current.outputs.find((output) => output.identifier === outputName)?.type ?? "str";
  const match = lastReturnDict(model.getValue());
  if (!match) return null;
  const body = match[2] ?? "";
  const start = model.getPositionAt(match.index + (match[1]?.length ?? 0) + body.length);
  const trimmed = body.trim();
  let separator = "";
  if (trimmed.length > 0) {
    separator = trimmed.endsWith(",") ? " " : ", ";
  }
  return {
    title: `Add "${outputName}" (${outputType}) to return dict`,
    kind: "quickfix",
    diagnostics: [marker],
    edit: {
      edits: [
        {
          resource: model.uri,
          versionId: model.getVersionId(),
          textEdit: {
            range: {
              startLineNumber: start.lineNumber,
              endLineNumber: start.lineNumber,
              startColumn: start.column,
              endColumn: start.column,
            },
            text: `${separator}"${outputName}": ${defaultValueLiteralFor(outputType)}`,
          },
        },
      ],
    },
  };
}
function indentationAction(
  model: editor.ITextModel,
  marker: editor.IMarkerData,
): languages.CodeAction {
  const line = model.getLineContent(marker.startLineNumber);
  const leading = /^([ \t]+)/.exec(line)?.[1] ?? "";
  let width = 0;
  for (const character of leading) width += character === "\t" ? 4 - (width % 4) : 1;
  return {
    title: "Normalize indentation to spaces",
    kind: "quickfix",
    diagnostics: [marker],
    edit: {
      edits: [
        {
          resource: model.uri,
          versionId: model.getVersionId(),
          textEdit: {
            range: {
              startLineNumber: marker.startLineNumber,
              endLineNumber: marker.startLineNumber,
              startColumn: 1,
              endColumn: leading.length + 1,
            },
            text: " ".repeat(width),
          },
        },
      ],
    },
  };
}
function actionForMarker(
  model: editor.ITextModel,
  marker: editor.IMarkerData,
  contractRef: ContractRef,
): languages.CodeAction | null {
  const code = markerCode(marker);
  if (code === MISSING_CLASS_CODE) return classAction(model, marker);
  if (code === MISSING_CALL_CODE) return callAction(model, marker);
  if (code?.startsWith(MISSING_OUTPUT_KEY)) return outputAction(model, marker, contractRef);
  if (code === MIXED_INDENT) return indentationAction(model, marker);
  return null;
}
function provideCodeActions(
  model: editor.ITextModel,
  context: languages.CodeActionContext,
  contractRef: ContractRef,
): languages.CodeActionList {
  const actions: languages.CodeAction[] = [];
  for (const marker of context.markers.filter(isQuickFixMarker)) {
    const action = actionForMarker(model, marker, contractRef);
    if (action) actions.push(action);
  }
  return { actions, dispose: () => void 0 };
}
export function registerCodeActions(monaco: Monaco, contractRef: ContractRef): IDisposable {
  return monaco.languages.registerCodeActionProvider("python", {
    provideCodeActions: (
      model: editor.ITextModel,
      _range: Range,
      context: languages.CodeActionContext,
    ) => provideCodeActions(model, context, contractRef),
  });
}
