import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, languages } from "monaco-editor";
import {
  CALL_METHOD_SNIPPET,
  CODE_SCAFFOLD_SNIPPET,
  type ContractRef,
  defaultValueLiteralFor,
  MISSING_CALL_CODE,
  MISSING_CLASS_CODE,
  MISSING_OUTPUT_KEY,
  MIXED_INDENT,
} from "./shared";

/**
 * Quick fixes for the scaffold-missing diagnostics. Monaco renders the
 * lightbulb on lines that have a matching marker; clicking it offers the
 * actions we return from here.
 */
export function registerCodeActions(
  monaco: Monaco,
  contractRef: ContractRef,
): IDisposable {
  return monaco.languages.registerCodeActionProvider("python", {
    provideCodeActions: (model, _range, context) => {
      const actions: languages.CodeAction[] = [];
      const matching = context.markers.filter((m) => {
        const c = typeof m.code === "string" ? m.code : m.code?.value;
        return (
          c === MISSING_CLASS_CODE ||
          c === MISSING_CALL_CODE ||
          c === MIXED_INDENT ||
          (typeof c === "string" && c.startsWith(MISSING_OUTPUT_KEY))
        );
      });
      if (matching.length === 0) {
        return { actions: [], dispose: () => undefined };
      }
      const fullRange = model.getFullModelRange();
      const source = model.getValue();
      const hasTrailingNewline = source.length === 0 || source.endsWith("\n");

      for (const marker of matching) {
        const markerCode =
          typeof marker.code === "string" ? marker.code : marker.code?.value;
        if (markerCode === MISSING_CLASS_CODE) {
          // Prepend the full class scaffold to the existing buffer so any
          // helper imports the user has at the top are preserved.
          const text = hasTrailingNewline
            ? CODE_SCAFFOLD_SNIPPET
            : "\n" + CODE_SCAFFOLD_SNIPPET;
          actions.push({
            title: "Insert `class Code` scaffold",
            kind: "quickfix",
            diagnostics: [marker],
            isPreferred: true,
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: {
                      startLineNumber: fullRange.endLineNumber,
                      endLineNumber: fullRange.endLineNumber,
                      startColumn: fullRange.endColumn,
                      endColumn: fullRange.endColumn,
                    },
                    text,
                  },
                },
              ],
            },
          });
        } else if (markerCode === MISSING_CALL_CODE) {
          // Insert the __call__ method on the line AFTER `class Code:`. If we
          // can't locate the class line, fall back to appending at the end of
          // the document.
          const lineCount = model.getLineCount();
          let insertLine = lineCount;
          for (let i = 1; i <= lineCount; i++) {
            if (/\bclass\s+Code\b/.test(model.getLineContent(i))) {
              insertLine = i + 1;
              break;
            }
          }
          actions.push({
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
                    range: {
                      startLineNumber: insertLine,
                      endLineNumber: insertLine,
                      startColumn: 1,
                      endColumn: 1,
                    },
                    text: CALL_METHOD_SNIPPET,
                  },
                },
              ],
            },
          });
        } else if (
          typeof markerCode === "string" &&
          markerCode.startsWith(MISSING_OUTPUT_KEY + ":")
        ) {
          // Add `"name": <typed default>` to the last `return { ... }` dict on
          // the class. If we can't find one, no-op (the user can use the
          // scaffold quick fix to land them in a known state first).
          const outputName = markerCode.slice(MISSING_OUTPUT_KEY.length + 1);
          const outputType =
            contractRef.current.outputs.find(
              (o) => o.identifier === outputName,
            )?.type ?? "str";
          const defaultLit = defaultValueLiteralFor(outputType);
          const returnRe = /(return\s*\{)([^}]*)\}/g;
          let lastMatch: RegExpExecArray | null = null;
          let m: RegExpExecArray | null;
          while ((m = returnRe.exec(source))) lastMatch = m;
          if (lastMatch) {
            const matchStart = lastMatch.index;
            const dictBodyStart = matchStart + (lastMatch[1]?.length ?? 0);
            const body = lastMatch[2] ?? "";
            const insertOffset = dictBodyStart + body.length;
            const startPos = model.getPositionAt(insertOffset);
            const sep = body.trim().length > 0 && !body.trimEnd().endsWith(",")
              ? ", "
              : body.trim().length > 0
                ? " "
                : "";
            actions.push({
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
                        startLineNumber: startPos.lineNumber,
                        endLineNumber: startPos.lineNumber,
                        startColumn: startPos.column,
                        endColumn: startPos.column,
                      },
                      text: `${sep}"${outputName}": ${defaultLit}`,
                    },
                  },
                ],
              },
            });
          }
        } else if (markerCode === MIXED_INDENT) {
          // Use the formatter's detab logic inline: replace just this line's
          // leading whitespace with 4-space columns.
          const lineNo = marker.startLineNumber;
          const line = model.getLineContent(lineNo);
          const leading = /^([ \t]+)/.exec(line)?.[1] ?? "";
          let indent = 0;
          for (const ch of leading) {
            indent += ch === "\t" ? 4 - (indent % 4) : 1;
          }
          actions.push({
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
                      startLineNumber: lineNo,
                      endLineNumber: lineNo,
                      startColumn: 1,
                      endColumn: leading.length + 1,
                    },
                    text: " ".repeat(indent),
                  },
                },
              ],
            },
          });
        }
      }
      return { actions, dispose: () => undefined };
    },
  });
}
