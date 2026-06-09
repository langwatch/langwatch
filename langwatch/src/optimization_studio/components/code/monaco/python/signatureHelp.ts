import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
import { PYTHON_BUILTIN_BY_NAME, type PyMember } from "../pythonStdlib";
import { scanImports } from "./shared";

/**
 * Pop the parameter-hint widget when the user opens a call expression. Resolves
 * the callee against the same catalogue the hover provider uses (builtins
 * + stdlib + imported modules). Re-triggers on commas so multi-arg calls keep
 * the hint visible.
 */
export function registerSignatureHelp(monaco: Monaco): IDisposable {
  const CALLEE_BEFORE_PAREN = /([A-Za-z_][\w.]*)\s*\($/;
  return monaco.languages.registerSignatureHelpProvider("python", {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp: (model, position) => {
      const lineBefore = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      // Find the nearest unclosed `(` on the current line so we can resolve
      // which call we're inside (handles `foo(bar(baz, |))` chains).
      let depth = 0;
      let openIdx = -1;
      for (let i = lineBefore.length - 1; i >= 0; i--) {
        const ch = lineBefore[i];
        if (ch === ")") depth++;
        else if (ch === "(") {
          if (depth === 0) {
            openIdx = i;
            break;
          }
          depth--;
        }
      }
      if (openIdx === -1) return null;

      const beforeOpen = lineBefore.slice(0, openIdx + 1);
      const calleeMatch = CALLEE_BEFORE_PAREN.exec(beforeOpen);
      if (!calleeMatch) return null;
      const callee = calleeMatch[1];
      if (!callee) return null;

      // Resolve callee → catalogue entry.
      let entry: PyMember | undefined;
      let label: string | undefined;
      if (callee.includes(".")) {
        const [owner, ...rest] = callee.split(".");
        const memberName = rest.join(".");
        if (owner === undefined) return null;
        const imports = scanImports(model.getValue());
        const mod = imports.get(owner);
        if (mod) {
          entry = mod.members.find((m) => m.name === memberName);
          if (entry) label = `${mod.name}.${entry.name}`;
        }
      } else {
        entry = PYTHON_BUILTIN_BY_NAME.get(callee);
        if (entry) label = entry.name;
      }
      if (!entry || !entry.signature) return null;

      const sigLabel = entry.signature ?? label ?? callee;
      // Cheap parameter slice: anything between the first `(` and the matching `)`.
      const paramListMatch = /\(([^)]*)\)/.exec(sigLabel);
      const paramListInner = paramListMatch?.[1] ?? "";
      const params = paramListInner
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => ({ label: p }));
      const activeArgIdx = lineBefore
        .slice(openIdx + 1)
        .split(",").length - 1;

      return {
        value: {
          signatures: [
            {
              label: sigLabel,
              documentation: entry.doc ?? "",
              parameters: params,
            },
          ],
          activeSignature: 0,
          activeParameter: Math.min(activeArgIdx, Math.max(0, params.length - 1)),
        },
        dispose: () => undefined,
      };
    },
  });
}
