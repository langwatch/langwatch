import type { CodeSource } from "../../code/ui/code-parts.tsx";

export function plainLines({ code }: { code: string }): string[] {
  return code
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}

export function plainSource({ code }: { code: string }): CodeSource {
  return {
    lang: "json",
    title: "Example",
    code,
    lines: plainLines({ code }),
    highlight: [],
    numbered: false,
  };
}
