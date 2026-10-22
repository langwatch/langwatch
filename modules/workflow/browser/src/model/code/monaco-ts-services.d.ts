/** The slice of Monaco's bundled TypeScript services the code-block typing test drives. */
declare module "monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js" {
  interface Diagnostic {
    readonly messageText: string | { readonly messageText: string };
  }

  interface LanguageServiceHost {
    getCompilationSettings(): object;
    getScriptFileNames(): string[];
    getScriptVersion(fileName: string): string;
    getScriptSnapshot(fileName: string): unknown;
    getScriptKind(fileName: string): number;
    getCurrentDirectory(): string;
    getDefaultLibFileName(options: object): string;
    fileExists(fileName: string): boolean;
    readFile(fileName: string): string | undefined;
  }

  interface LanguageService {
    getSemanticDiagnostics(fileName: string): Diagnostic[];
    getSyntacticDiagnostics(fileName: string): Diagnostic[];
  }

  export const typescript: {
    readonly ModuleKind: { readonly ESNext: number };
    readonly ScriptTarget: { readonly ESNext: number };
    readonly ScriptKind: { readonly JS: number; readonly TS: number };
    ScriptSnapshot: { fromString(text: string): unknown };
    createLanguageService(host: LanguageServiceHost): LanguageService;
    flattenDiagnosticMessageText(messageText: Diagnostic["messageText"], newLine: string): string;
  };
}

declare module "monaco-editor/esm/vs/language/typescript/lib/lib.js" {
  export const libFileMap: Readonly<Record<string, string>>;
}
