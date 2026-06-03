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
} from "./shared";

/**
 * Lightweight client-side validator — flags mismatched brackets, unterminated
 * strings, tabs-after-spaces indentation, and (when the node has declared
 * outputs) any output keys missing from the user's `return {...}` dict. Not a
 * full Python parser; it catches the structural mistakes users hit most
 * without a server round-trip.
 */
export interface ValidatorHandle extends IDisposable {
  revalidate: () => void;
}

export function registerValidator(
  monaco: Monaco,
  contractRef: ContractRef,
): ValidatorHandle {
  const owner = "langwatch-python-lint";

  const validate = (model: editor.ITextModel): void => {
    if (model.getLanguageId() !== "python") return;
    const markers: editor.IMarkerData[] = [];
    const source = model.getValue();
    const lines = source.split("\n");

    const stack: { ch: string; line: number; col: number }[] = [];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    let inString: false | '"' | "'" | '"""' | "'''" = false;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx] ?? "";
      let col = 0;
      while (col < line.length) {
        const ch = line[col];
        const next2 = line.slice(col, col + 3);

        if (inString) {
          if (
            (inString === '"""' || inString === "'''") &&
            next2 === inString
          ) {
            inString = false;
            col += 3;
            continue;
          }
          if ((inString === '"' || inString === "'") && ch === inString) {
            inString = false;
            col += 1;
            continue;
          }
          if (ch === "\\") {
            col += 2;
            continue;
          }
          col += 1;
          continue;
        }

        if (ch === "#") break;

        if (next2 === '"""' || next2 === "'''") {
          inString = next2 as '"""' | "'''";
          col += 3;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inString = ch;
          col += 1;
          continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") {
          stack.push({ ch, line: lineIdx, col });
        } else if (ch === ")" || ch === "]" || ch === "}") {
          const expected = pairs[ch];
          const top = stack[stack.length - 1];
          if (!top || top.ch !== expected) {
            markers.push({
              severity: monaco.MarkerSeverity.Error,
              message: `Unmatched closing '${ch}'`,
              startLineNumber: lineIdx + 1,
              startColumn: col + 1,
              endLineNumber: lineIdx + 1,
              endColumn: col + 2,
            });
          } else {
            stack.pop();
          }
        }
        col += 1;
      }

      if (inString === '"' || inString === "'") {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: `Unterminated string literal`,
          startLineNumber: lineIdx + 1,
          startColumn: 1,
          endLineNumber: lineIdx + 1,
          endColumn: line.length + 1,
        });
        inString = false;
      }

      const leading = /^([ \t]+)/.exec(line);
      if (leading && /\t/.test(leading[1] ?? "") && / /.test(leading[1] ?? "")) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          code: MIXED_INDENT,
          message: "Mixed tabs and spaces in indentation",
          startLineNumber: lineIdx + 1,
          startColumn: 1,
          endLineNumber: lineIdx + 1,
          endColumn: (leading[1]?.length ?? 0) + 1,
        });
      }
    }

    if (inString === '"""' || inString === "'''") {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: "Unterminated triple-quoted string",
        startLineNumber: lines.length,
        startColumn: 1,
        endLineNumber: lines.length,
        endColumn: (lines[lines.length - 1]?.length ?? 0) + 1,
      });
    }

    for (const open of stack) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: `Unclosed '${open.ch}'`,
        startLineNumber: open.line + 1,
        startColumn: open.col + 1,
        endLineNumber: open.line + 1,
        endColumn: open.col + 2,
      });
    }

    // Required scaffold — the workflow runtime invokes `Code().__call__(input)`
    // so the user code must define a `Code` class with a `__call__` method.
    // Surface a real Error marker if either piece is missing so accidental
    // deletion fails fast in-editor instead of at run time. The `code` field
    // doubles as the quick-fix discriminator (see registerCodeActions below).
    if (!/\bclass\s+Code\b/.test(source)) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        code: MISSING_CLASS_CODE,
        message:
          "Missing `class Code:` declaration — the workflow runtime calls `Code().__call__(input)`. Add it back so the node can execute.",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
      });
    } else if (!/\bdef\s+__call__\s*\(/.test(source)) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        code: MISSING_CALL_CODE,
        message:
          "Missing `def __call__(self, input: str):` on `class Code` — the workflow runtime invokes it to run the node.",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
      });
    }

    // Output contract — warn when a declared output is never referenced as a
    // string key in the source. Cheap: matches `"name"` or `'name'`. Misses
    // dynamic key construction, which is rare in code nodes.
    const declaredOutputs = contractRef.current.outputs;
    if (declaredOutputs.length > 0) {
      for (const field of declaredOutputs) {
        const escaped = field.identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const keyRe = new RegExp(`["']${escaped}["']`);
        if (!keyRe.test(source)) {
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

      // Cheap literal-type-mismatch lint. Walk the last `return {…}` dict on
      // the source and, for each declared output that has an obviously-typed
      // literal value (string, number, bool, list, dict), warn when the
      // literal kind doesn't match the declared type. Variable references and
      // function calls fall through unchecked — too many false positives
      // without a real Python parser.
      const lastReturn = findLastReturnDict(source);
      if (lastReturn) {
        const entries = parseSimpleDictEntries(lastReturn.body);
        for (const entry of entries) {
          const declared = declaredOutputs.find(
            (o) => o.identifier === entry.key,
          );
          if (!declared) continue;
          const expectedKind = literalKindFor(declared.type);
          const actualKind = literalKindOf(entry.value);
          if (actualKind && expectedKind && actualKind !== expectedKind) {
            const valueOffset = lastReturn.bodyStart + entry.valueOffset;
            const startPos = model.getPositionAt(valueOffset);
            const endPos = model.getPositionAt(
              valueOffset + entry.value.length,
            );
            markers.push({
              severity: monaco.MarkerSeverity.Warning,
              code: `${OUTPUT_TYPE_MISMATCH}:${entry.key}`,
              message: `Declared output "${entry.key}" expects ${declared.type} but the return value looks like ${actualKind}.`,
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            });
          }
        }
      }
    }

    monaco.editor.setModelMarkers(model, owner, markers);
  };

  const onChangeDisposers: IDisposable[] = [];
  const onCreate = monaco.editor.onDidCreateModel((model) => {
    validate(model);
    onChangeDisposers.push(model.onDidChangeContent(() => validate(model)));
  });
  for (const model of monaco.editor.getModels()) {
    validate(model);
    onChangeDisposers.push(model.onDidChangeContent(() => validate(model)));
  }
  return {
    dispose: () => {
      onCreate.dispose();
      for (const d of onChangeDisposers) d.dispose();
      for (const model of monaco.editor.getModels()) {
        monaco.editor.setModelMarkers(model, owner, []);
      }
    },
    // Force a re-run across every python model — call this when the contract
    // changes so markers refresh immediately (incl. on empty buffers, where
    // the previous applyEdits-no-op trick produced no change event).
    revalidate: () => {
      for (const model of monaco.editor.getModels()) {
        if (model.getLanguageId() === "python") validate(model);
      }
    },
  };
}
