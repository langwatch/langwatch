import type { CodeSource } from "../../code/ui/code-parts.tsx";

export function plainLines({ code }: { code: string }): string[] {
  return code
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}

function jsonLines({ code }: { code: string }): string[] {
  return code.split("\n").map((line) => {
    const parts = line.split(
      /("(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi,
    );
    return parts
      .map((part, index) => {
        const escaped = plainLines({ code: part })[0];
        if (index % 2 === 0) return escaped;
        const string = part.startsWith('"');
        const key = string && /^\s*:/.test(parts[index + 1] ?? "");
        let kind = "value";
        if (string) kind = key ? "key" : "string";
        return `<span class="docs-json-${kind}">${escaped}</span>`;
      })
      .join("");
  });
}

export function plainSource({ code }: { code: string }): CodeSource {
  return {
    lang: "json",
    title: "Example",
    code,
    lines: jsonLines({ code }),
    highlight: [],
    numbered: false,
  };
}
