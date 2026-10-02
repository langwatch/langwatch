export interface ParsedSnippet {
  code: string;
  highlightLines: number[];
}

export function parseSnippet(raw: string): ParsedSnippet {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const highlightLines: number[] = [];

  const processed = lines.map((line, idx) => {
    if (/(?:\s*\/\/\s*\+\s*|\s*#\s*\+\s*)$/.test(line)) {
      highlightLines.push(idx + 1);

      return line.replace(/\s*(?:\/\/|#)\s*\+\s*$/, "");
    }

    return line;
  });

  return { code: processed.join("\n"), highlightLines };
}
