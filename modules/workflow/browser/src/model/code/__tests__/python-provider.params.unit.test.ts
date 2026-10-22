import type { Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import { describe, expect, it } from "vitest";

import { registerCompletion } from "../python-provider.completion.ts";
import { registerHover } from "../python-provider.hover.ts";
import type { ContractRef } from "../python-provider.shared.ts";

const contractRef: ContractRef = {
  current: { secretNames: [], inputs: [{ identifier: "question", type: "str" }], outputs: [] },
};

function fakeMonaco() {
  const providers: {
    completion?: languages.CompletionItemProvider;
    hover?: languages.HoverProvider;
  } = {};
  const dispose = { dispose: () => undefined };
  const monaco: Monaco = {
    languages: {
      CompletionItemKind: { Variable: 4, Keyword: 17, Module: 8, Field: 3, Function: 1 },
      registerCompletionItemProvider: (_: string, provider: languages.CompletionItemProvider) => {
        providers.completion = provider;
        return dispose;
      },
      registerHoverProvider: (_: string, provider: languages.HoverProvider) => {
        providers.hover = provider;
        return dispose;
      },
    },
  };
  return { monaco, providers };
}

/** A one-line model with the cursor at the end of `line`. */
function modelFor({ line }: { line: string }) {
  const word = /[\w]*$/.exec(line)?.[0] ?? "";
  return {
    getValue: () => line,
    getValueInRange: () => line,
    getWordUntilPosition: () => ({
      startColumn: line.length - word.length + 1,
      endColumn: line.length + 1,
    }),
    getWordAtPosition: () =>
      word
        ? { word, startColumn: line.length - word.length + 1, endColumn: line.length + 1 }
        : null,
  };
}

const position = (line: string) => ({ lineNumber: 1, column: line.length + 1 });

describe("Python providers and run parameters", () => {
  describe("given a fresh line", () => {
    it("offers the params handle", async () => {
      const { monaco, providers } = fakeMonaco();
      registerCompletion(monaco, contractRef);
      const line = "    x = pa";
      const result = await providers.completion!.provideCompletionItems(
        modelFor({ line }) as never,
        position(line) as never,
        {} as never,
        {} as never,
      );
      expect(result?.suggestions.map((s) => s.label)).toContain("params");
    });
  });

  describe("when hovering params.NAME", () => {
    it("explains the run parameter", async () => {
      const { monaco, providers } = fakeMonaco();
      registerHover(monaco, contractRef);
      const line = "    limit = params.limit";
      const hover = await providers.hover!.provideHover(
        modelFor({ line }) as never,
        position(line) as never,
        {} as never,
      );
      const text = hover?.contents.map((c) => c.value).join("\n");
      expect(text).toContain("params.limit");
      expect(text).toContain("keeps its JSON type");
    });
  });
});
