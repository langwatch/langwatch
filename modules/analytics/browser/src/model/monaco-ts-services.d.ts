/** The slice of Monaco's bundled TypeScript services the widget typing test drives. */
declare module "monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js" {
  interface Diagnostic {
    readonly messageText: string | { readonly messageText: string };
    readonly start?: number;
    readonly code: number;
  }

  interface LanguageServiceHost {
    getCompilationSettings(): object;
    getScriptFileNames(): string[];
    getScriptVersion(fileName: string): string;
    getScriptSnapshot(fileName: string): unknown;
    getCurrentDirectory(): string;
    getDefaultLibFileName(options: object): string;
    fileExists(fileName: string): boolean;
    readFile(fileName: string): string | undefined;
  }

  interface SymbolDisplayPart {
    readonly text: string;
    readonly kind: string;
  }

  interface CompletionInfo {
    readonly entries: readonly { readonly name: string }[];
  }

  interface CompletionEntryDetails {
    readonly displayParts: SymbolDisplayPart[];
  }

  interface LanguageService {
    getSemanticDiagnostics(fileName: string): Diagnostic[];
    getSyntacticDiagnostics(fileName: string): Diagnostic[];
    getCompletionsAtPosition(
      fileName: string,
      position: number,
      options: object | undefined,
    ): CompletionInfo | undefined;
    getCompletionEntryDetails(
      fileName: string,
      position: number,
      entryName: string,
      formatOptions: object | undefined,
      source: string | undefined,
      preferences: object | undefined,
      data: unknown,
    ): CompletionEntryDetails | undefined;
  }

  export const typescript: {
    readonly JsxEmit: { readonly React: number };
    readonly ModuleKind: { readonly ESNext: number };
    readonly ModuleResolutionKind: { readonly NodeJs: number };
    readonly ScriptTarget: { readonly ES2020: number };
    ScriptSnapshot: { fromString(text: string): unknown };
    createLanguageService(host: LanguageServiceHost): LanguageService;
    flattenDiagnosticMessageText(messageText: Diagnostic["messageText"], newLine: string): string;
    displayPartsToString(displayParts: readonly SymbolDisplayPart[] | undefined): string;
  };
}

declare module "monaco-editor/esm/vs/language/typescript/lib/lib.js" {
  export const libFileMap: Readonly<Record<string, string>>;
}
