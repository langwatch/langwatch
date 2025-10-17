import { FRAMEWORKS_BY_PLATFORM } from "../constants";

import goBaseRaw from "./snippets/go/base";
import goOpenAiRaw from "./snippets/go/openai";
import goAzureRaw from "./snippets/go/azure";
import goGrokRaw from "./snippets/go/grok";
import goMistralRaw from "./snippets/go/mistral";
import goAnthropicRaw from "./snippets/go/anthropic";
import goGeminiRaw from "./snippets/go/gemini";
import goOllamaRaw from "./snippets/go/ollama";

import tsBaseRaw from "./snippets/typescript/base";
import tsVercelAiRaw from "./snippets/typescript/vercelai";

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


type LocalGoFrameworkKey = (typeof FRAMEWORKS_BY_PLATFORM)["go"][number]["key"];

export const GO_SNIPPETS: Record<LocalGoFrameworkKey | "base", ParsedSnippet> = {
  base: parseSnippet(goBaseRaw),
  openai: parseSnippet(goOpenAiRaw),
  azure: parseSnippet(goAzureRaw),
  grok: parseSnippet(goGrokRaw),
  mistral: parseSnippet(goMistralRaw),
  anthropic: parseSnippet(goAnthropicRaw),
  gemini: parseSnippet(goGeminiRaw),
  ollama: parseSnippet(goOllamaRaw),
};

export const TS_SNIPPETS = {
  base: parseSnippet(tsBaseRaw),
  vercel_ai: parseSnippet(tsVercelAiRaw),
};


