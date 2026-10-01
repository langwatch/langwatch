// Workflow code-node formatting provider.
import type { Monaco } from "@monaco-editor/react";
import type { editor, IDisposable } from "monaco-editor";

/**
 * Heuristic Python formatter — re-indents to 4-space multiples, trims
 * trailing whitespace, collapses 3+ blank lines to 2. Not trying to match
 * Black; the goal is in-editor hygiene without a server round-trip.
 */
function normalizeIndentation(line: string): string {
  let indent = 0;
  let position = 0;
  while (position < line.length) {
    const character = line[position];
    if (character === " ") indent += 1;
    else if (character === "\t") indent += 4 - (indent % 4);
    else break;
    position += 1;
  }
  const content = line.slice(position).replace(/[ \t]+$/, "");
  return content.length === 0 ? "" : " ".repeat(indent) + content;
}

function formatPythonSource(source: string): string {
  const formatted: string[] = [];
  let blankRun = 0;
  for (const line of source.split("\n")) {
    const normalized = normalizeIndentation(line);
    if (normalized.length === 0) {
      blankRun += 1;
      if (blankRun <= 2) formatted.push("");
      continue;
    }
    blankRun = 0;
    formatted.push(normalized);
  }
  while (formatted[0] === "") formatted.shift();
  while (formatted.at(-1) === "") formatted.pop();
  return formatted.join("\n") + "\n";
}

export function registerFormatter(monaco: Monaco): IDisposable {
  return monaco.languages.registerDocumentFormattingEditProvider("python", {
    provideDocumentFormattingEdits: (model: editor.ITextModel) => {
      const source = model.getValue();
      const formatted = formatPythonSource(source);
      if (formatted === source) return [];
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });
}
