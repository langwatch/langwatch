import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";

/**
 * Heuristic Python formatter — re-indents to multiples of 4 spaces, trims
 * trailing whitespace, and collapses runs of 3+ blank lines into 2. We do not
 * try to match Black; the goal is consistent in-editor hygiene without
 * depending on a server round-trip.
 */
export function registerFormatter(monaco: Monaco): IDisposable {
  return monaco.languages.registerDocumentFormattingEditProvider("python", {
    provideDocumentFormattingEdits: (model) => {
      const source = model.getValue();
      const lines = source.split("\n");

      const detab = (line: string): string => {
        let indent = 0;
        let i = 0;
        while (i < line.length) {
          const ch = line[i];
          if (ch === " ") {
            indent += 1;
          } else if (ch === "\t") {
            indent += 4 - (indent % 4);
          } else {
            break;
          }
          i += 1;
        }
        const rest = line.slice(i).replace(/[ \t]+$/, "");
        if (rest.length === 0) return "";
        return " ".repeat(indent) + rest;
      };

      const formatted: string[] = [];
      let blankRun = 0;
      for (const line of lines) {
        const out = detab(line);
        if (out.length === 0) {
          blankRun += 1;
          if (blankRun <= 2) formatted.push("");
        } else {
          blankRun = 0;
          formatted.push(out);
        }
      }
      while (formatted.length > 0 && formatted[0] === "") formatted.shift();
      while (formatted.length > 0 && formatted[formatted.length - 1] === "") {
        formatted.pop();
      }
      const next = formatted.join("\n") + "\n";

      if (next === source) return [];
      return [
        {
          range: model.getFullModelRange(),
          text: next,
        },
      ];
    },
  });
}
