import type { Monaco } from "@monaco-editor/react";
import type { editor, IDisposable, Position } from "monaco-editor";

import { scanImports } from "./python-provider.shared.ts";
import { PYTHON_BUILTIN_BY_NAME, type PyMember } from "./python-stdlib.ts";

/**
 * Pop the parameter-hint widget when the user opens a call expression.
 * Resolves the callee against the hover provider's catalogue (builtins +
 * stdlib + imported modules); re-triggers on commas for multi-arg calls.
 */
export function registerSignatureHelp(monaco: Monaco): IDisposable {
  const CALLEE_BEFORE_PAREN = /([A-Za-z_][\w.]*)\s*\($/;
  return monaco.languages.registerSignatureHelpProvider("python", {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp: (model: editor.ITextModel, position: Position) => {
      const lineBefore = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const openIdx = unclosedParenIndex(lineBefore);
      if (openIdx === -1) return null;

      const beforeOpen = lineBefore.slice(0, openIdx + 1);
      const calleeMatch = CALLEE_BEFORE_PAREN.exec(beforeOpen);
      if (!calleeMatch) return null;
      const callee = calleeMatch[1];
      if (!callee) return null;

      const { entry, label } = resolveCallee({ callee, model });
      if (!entry?.signature) return null;

      const sigLabel = entry.signature ?? label ?? callee;
      // Cheap parameter slice: anything between the first `(` and the matching `)`.
      const paramListMatch = /\(([^)]*)\)/.exec(sigLabel);
      const paramListInner = paramListMatch?.[1] ?? "";
      const params = paramListInner
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => ({ label: p }));
      const activeArgIdx = lineBefore.slice(openIdx + 1).split(",").length - 1;

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
        dispose: () => void 0,
      };
    },
  });
}

/**
 * The nearest unclosed `(` on the line, so we can resolve which call we're
 * inside (handles `foo(bar(baz, |))` chains); -1 when there is none.
 */
function unclosedParenIndex(lineBefore: string): number {
  let depth = 0;
  for (let i = lineBefore.length - 1; i >= 0; i--) {
    const ch = lineBefore[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** Resolve callee → catalogue entry. */
function resolveCallee({ callee, model }: { callee: string; model: editor.ITextModel }): {
  entry: PyMember | undefined;
  label: string | undefined;
} {
  if (!callee.includes(".")) {
    const entry = PYTHON_BUILTIN_BY_NAME.get(callee);
    return { entry, label: entry?.name };
  }
  const [owner, ...rest] = callee.split(".");
  const memberName = rest.join(".");
  if (owner === void 0) return { entry: undefined, label: undefined };
  const mod = scanImports(model.getValue()).get(owner);
  if (!mod) return { entry: undefined, label: undefined };
  const entry = mod.members.find((m) => m.name === memberName);
  return { entry, label: entry ? `${mod.name}.${entry.name}` : undefined };
}
