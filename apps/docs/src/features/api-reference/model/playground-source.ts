import type { CodeSource } from "../../code/model.ts";
import { jsonTokens } from "./json-tokens.ts";

export function plainLines({ code }: { code: string }): string[] {
  return code
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}

function jsonLines({ code }: { code: string }): string[] {
  return code.split("\n").map((line) =>
    jsonTokens({ text: line })
      .map(({ text, kind }) => {
        const escaped = plainLines({ code: text })[0];
        return kind === "plain" ? escaped : `<span class="docs-json-${kind}">${escaped}</span>`;
      })
      .join(""),
  );
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
