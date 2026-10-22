import type * as MonacoApi from "monaco-editor";
import { describe, expect, it } from "vitest";

import {
  type JavaScriptMonaco,
  registerJavaScriptLanguageService,
} from "../javascript-language-service.ts";

type CompilerOptions = MonacoApi.typescript.CompilerOptions;
type DiagnosticsOptions = MonacoApi.typescript.DiagnosticsOptions;

function fakeMonaco() {
  const libs = new Map<string, string>();
  let compilerOptions: CompilerOptions = { lib: ["dom"] };
  let diagnosticsOptions: DiagnosticsOptions = { noSemanticValidation: true };
  const monaco: JavaScriptMonaco = {
    languages: {
      typescript: {
        javascriptDefaults: {
          getCompilerOptions: () => compilerOptions,
          setCompilerOptions: (next) => (compilerOptions = next),
          getDiagnosticsOptions: () => diagnosticsOptions,
          setDiagnosticsOptions: (next) => (diagnosticsOptions = next),
          addExtraLib: (text, uri = "") => {
            libs.set(uri, text);
            return { dispose: () => libs.delete(uri) };
          },
        },
        ModuleKind: { ESNext: 99 },
        ScriptTarget: { ESNext: 99 },
      },
    },
  };
  return {
    monaco,
    libs,
    compilerOptions: () => compilerOptions,
    diagnosticsOptions: () => diagnosticsOptions,
  };
}

const contract = {
  secretNames: ["TOKEN"],
  inputs: [{ identifier: "question", type: "str" }],
  outputs: [{ identifier: "answer", type: "str" }],
};

describe("registerJavaScriptLanguageService", () => {
  describe("when a JavaScript editor opens", () => {
    it("checks JavaScript as ES2023 without DOM, with diagnostics on", () => {
      const fake = fakeMonaco();
      registerJavaScriptLanguageService({ monaco: fake.monaco, contract });

      expect(fake.compilerOptions()).toMatchObject({
        lib: ["es2023"],
        checkJs: true,
        allowJs: true,
      });
      expect(fake.diagnosticsOptions()).toEqual({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });
    });

    it("adds one ambient lib with the node's globals", () => {
      const fake = fakeMonaco();
      registerJavaScriptLanguageService({ monaco: fake.monaco, contract });

      expect(fake.libs.size).toBe(1);
      expect([...fake.libs.values()][0]).toContain("readonly TOKEN: string;");
    });
  });

  describe("when the node's contract changes", () => {
    it("replaces the lib under the same uri", () => {
      const fake = fakeMonaco();
      const handle = registerJavaScriptLanguageService({ monaco: fake.monaco, contract });
      const [uri] = [...fake.libs.keys()];

      handle.setContract({ ...contract, secretNames: ["OTHER"] });

      expect([...fake.libs.keys()]).toEqual([uri]);
      expect(fake.libs.get(uri!)).toContain("readonly OTHER: string;");
      expect(fake.libs.get(uri!)).not.toContain("TOKEN");
    });
  });

  describe("when the editor closes", () => {
    it("removes the lib and restores the page's previous options", () => {
      const fake = fakeMonaco();
      const handle = registerJavaScriptLanguageService({ monaco: fake.monaco, contract });

      handle.dispose();

      expect(fake.libs.size).toBe(0);
      expect(fake.compilerOptions()).toEqual({ lib: ["dom"] });
      expect(fake.diagnosticsOptions()).toEqual({ noSemanticValidation: true });
    });
  });
});
