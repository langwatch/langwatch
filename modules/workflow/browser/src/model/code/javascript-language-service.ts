import type * as MonacoApi from "monaco-editor";

import { buildJavaScriptRuntimeDts, type JavaScriptField } from "./javascript-runtime-types.ts";

type Defaults = MonacoApi.typescript.LanguageServiceDefaults;

type DrivenDefaults = Pick<
  Defaults,
  | "getCompilerOptions"
  | "setCompilerOptions"
  | "getDiagnosticsOptions"
  | "setDiagnosticsOptions"
  | "addExtraLib"
>;

/** The part of Monaco's TypeScript API this service drives. */
export interface TypeScriptSlice {
  javascriptDefaults: DrivenDefaults;
  typescriptDefaults: DrivenDefaults;
  ModuleKind: { readonly ESNext: number };
  ScriptTarget: { readonly ESNext: number };
}

/**
 * The AMD build the loader fetches sets `languages.typescript` on its global; the ESM
 * types mark that deprecated in favour of a top-level `typescript`. Either will do.
 */
export interface JavaScriptMonaco {
  typescript?: TypeScriptSlice;
  languages: { typescript?: TypeScriptSlice | { deprecated: true } };
}

function typescriptOf({ monaco }: { monaco: JavaScriptMonaco }): TypeScriptSlice | undefined {
  const legacy = monaco.languages.typescript;
  if (legacy && "javascriptDefaults" in legacy) return legacy;
  return monaco.typescript;
}

export interface JavaScriptContract {
  secretNames: readonly string[];
  inputs: readonly JavaScriptField[];
  outputs: readonly JavaScriptField[];
}

export interface JavaScriptLanguageServiceHandle {
  setContract: (next: JavaScriptContract) => void;
  dispose: () => void;
}

let nextLibId = 0;

/**
 * QuickJS speaks ES2023 modules and has no DOM, so neither does the checker. The editor's
 * model has no file extension, which the worker reads as JavaScript only under allowJs.
 */
export function codeBlockCompilerOptions({
  enums,
  flavour = "javascript",
}: {
  enums: {
    ModuleKind: { readonly ESNext: number };
    ScriptTarget: { readonly ESNext: number };
  };
  flavour?: "javascript" | "typescript";
}) {
  const javascript = flavour === "javascript";
  return {
    target: enums.ScriptTarget.ESNext,
    module: enums.ModuleKind.ESNext,
    lib: ["es2023"],
    allowJs: javascript,
    checkJs: javascript,
    noEmit: true,
    allowNonTsExtensions: true,
  };
}

/**
 * Points Monaco's JavaScript or TypeScript worker at the code-block runtime: ES2023 without
 * DOM, checked, and this node's globals. The defaults are page-wide, so dispose puts the
 * previous options back and removes the lib, keeping other editors untouched.
 */
export function registerJavaScriptLanguageService({
  monaco,
  contract,
  flavour = "javascript",
}: {
  monaco: JavaScriptMonaco;
  contract: JavaScriptContract;
  flavour?: "javascript" | "typescript";
}): JavaScriptLanguageServiceHandle {
  const typescript = typescriptOf({ monaco });
  if (!typescript) return { setContract: () => undefined, dispose: () => undefined };
  const { ModuleKind, ScriptTarget } = typescript;
  const defaults =
    flavour === "typescript" ? typescript.typescriptDefaults : typescript.javascriptDefaults;
  const previousCompilerOptions = defaults.getCompilerOptions();
  const previousDiagnosticsOptions = defaults.getDiagnosticsOptions();
  defaults.setCompilerOptions(
    codeBlockCompilerOptions({ enums: { ModuleKind, ScriptTarget }, flavour }),
  );
  defaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });

  const uri = `file:///langwatch/code-block-runtime-${nextLibId++}.d.ts`;
  let text = buildJavaScriptRuntimeDts(contract);
  let lib = defaults.addExtraLib(text, uri);

  return {
    setContract: (next) => {
      const nextText = buildJavaScriptRuntimeDts(next);
      if (nextText === text) return;
      lib.dispose();
      text = nextText;
      lib = defaults.addExtraLib(text, uri);
    },
    dispose: () => {
      lib.dispose();
      defaults.setCompilerOptions(previousCompilerOptions);
      defaults.setDiagnosticsOptions(previousDiagnosticsOptions);
    },
  };
}
