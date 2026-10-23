import type * as MonacoApi from "monaco-editor";
import { describe, expect, it } from "vitest";

import {
  type JavaScriptMonaco,
  registerJavaScriptLanguageService,
} from "../javascript-language-service.ts";

type CompilerOptions = MonacoApi.typescript.CompilerOptions;
type DiagnosticsOptions = MonacoApi.typescript.DiagnosticsOptions;

function fakeDefaults() {
  const libs = new Map<string, string>();
  let compilerOptions: CompilerOptions = { lib: ["dom"] };
  let diagnosticsOptions: DiagnosticsOptions = { noSemanticValidation: true };
  return {
    libs,
    compilerOptions: () => compilerOptions,
    diagnosticsOptions: () => diagnosticsOptions,
    defaults: {
      getCompilerOptions: () => compilerOptions,
      setCompilerOptions: (next: CompilerOptions) => (compilerOptions = next),
      getDiagnosticsOptions: () => diagnosticsOptions,
      setDiagnosticsOptions: (next: DiagnosticsOptions) => (diagnosticsOptions = next),
      addExtraLib: (text: string, uri = "") => {
        libs.set(uri, text);
        return { dispose: () => libs.delete(uri) };
      },
    },
  };
}

function fakeMonaco() {
  const javascript = fakeDefaults();
  const typescript = fakeDefaults();
  const monaco: JavaScriptMonaco = {
    languages: {
      typescript: {
        javascriptDefaults: javascript.defaults,
        typescriptDefaults: typescript.defaults,
        ModuleKind: { ESNext: 99 },
        ScriptTarget: { ESNext: 99 },
      },
    },
  };
  return { ...javascript, monaco, typescript };
}

const contract = {
  secretNames: ["TOKEN"],
  inputs: [{ identifier: "question", type: "str" }],
  outputs: [{ identifier: "answer", type: "str" }],
};

describe("registerJavaScriptLanguageService", () => {
  describe("when a JavaScript editor opens", () => {
    /**
     * @scenario "JavaScript is checked as ES2023 without DOM"
     */
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

    /**
     * @scenario "The runtime library is added under one uri per editor"
     */
    it("adds one ambient lib with the node's globals", () => {
      const fake = fakeMonaco();
      registerJavaScriptLanguageService({ monaco: fake.monaco, contract });

      expect(fake.libs.size).toBe(1);
      expect([...fake.libs.values()][0]).toContain("readonly TOKEN: string;");
    });
  });

  describe("when a TypeScript editor opens", () => {
    /**
     * @scenario "TypeScript is checked against the node's contract as you write"
     */
    it("checks it in the TypeScript worker with the node's globals, leaving JavaScript alone", () => {
      const fake = fakeMonaco();
      const handle = registerJavaScriptLanguageService({
        monaco: fake.monaco,
        contract,
        flavour: "typescript",
      });

      expect(fake.typescript.compilerOptions()).toMatchObject({ lib: ["es2023"] });
      expect(fake.typescript.diagnosticsOptions()).toEqual({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });
      expect([...fake.typescript.libs.values()][0]).toContain("readonly TOKEN: string;");
      expect(fake.libs.size).toBe(0);
      expect(fake.compilerOptions()).toEqual({ lib: ["dom"] });

      handle.dispose();

      expect(fake.typescript.libs.size).toBe(0);
      expect(fake.typescript.compilerOptions()).toEqual({ lib: ["dom"] });
    });
  });

  describe("when the node's contract changes", () => {
    /**
     * @scenario "A changed contract replaces the library"
     */
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

  describe("when two editors are open", () => {
    /**
     * @scenario "Two open editors do not share a library"
     */
    it("gives each its own library, so closing one leaves the other's", () => {
      const fake = fakeMonaco();
      const first = registerJavaScriptLanguageService({ monaco: fake.monaco, contract });
      registerJavaScriptLanguageService({
        monaco: fake.monaco,
        contract: { ...contract, secretNames: ["SECOND"] },
      });
      const [firstUri, secondUri] = [...fake.libs.keys()];
      expect(firstUri).not.toBe(secondUri);

      first.dispose();

      expect(fake.libs.has(firstUri!)).toBe(false);
      expect(fake.libs.get(secondUri!)).toContain("readonly SECOND: string;");
    });
  });

  describe("when the editor closes", () => {
    /**
     * @scenario "Closing the editor removes the library and restores the page's options"
     */
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
