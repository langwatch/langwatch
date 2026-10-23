import { libFileMap } from "monaco-editor/esm/vs/language/typescript/lib/lib.js";
import { typescript as ts } from "monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js";
import { describe, expect, it } from "vitest";

import { MODULES } from "../../studio-registry.ts";
import { codeTemplate } from "../code-templates.ts";
import { codeBlockCompilerOptions } from "../javascript-language-service.ts";
import { buildJavaScriptRuntimeDts, tsTypeFor } from "../javascript-runtime-types.ts";

const contract = {
  secretNames: ["API_KEY", "weird-name"],
  inputs: [
    { identifier: "question", type: "str" },
    { identifier: "count", type: "int" },
    { identifier: "flags", type: "list[bool]" },
  ],
  outputs: [{ identifier: "answer", type: "str" }],
};

const CODE_URI = "inmemory://model/1";
const RUNTIME_URI = "file:///langwatch/code-block-runtime-0.d.ts";

/** Monaco's worker reads a lib by its file name or by the bare `lib` option entry. */
const libText = (name: string) => libFileMap[name] ?? libFileMap[`lib.${name}.d.ts`];

/** Monaco's own TypeScript over one code block, hosted the way its JS worker hosts it. */
function serviceFor({ code, typescript = false }: { code: string; typescript?: boolean }) {
  const files = new Map([
    [CODE_URI, code],
    [RUNTIME_URI, buildJavaScriptRuntimeDts(contract)],
  ]);
  const read = (name: string) => files.get(name) ?? libText(name);
  const options = codeBlockCompilerOptions({
    enums: ts,
    flavour: typescript ? "typescript" : "javascript",
  });
  const service = ts.createLanguageService({
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const text = read(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    // As Monaco's worker decides: by extension, and an extensionless model is
    // JavaScript under allowJs.
    getScriptKind: (name) =>
      name.endsWith(".ts") || !options.allowJs ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "lib.es2023.d.ts",
    fileExists: (name) => read(name) !== undefined,
    readFile: read,
  });
  return service;
}

function diagnosticsFor({
  code,
  typescript = false,
}: {
  code: string;
  typescript?: boolean;
}): string[] {
  const service = serviceFor({ code, typescript });
  return [
    ...service.getSyntacticDiagnostics(CODE_URI),
    ...service.getSemanticDiagnostics(CODE_URI),
  ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("buildJavaScriptRuntimeDts", () => {
  describe("given secrets, inputs and outputs", () => {
    const dts = buildJavaScriptRuntimeDts(contract);

    /**
     * @scenario "Secrets are declared as documented read-only strings"
     */
    it("declares each secret as a documented readonly string", () => {
      expect(dts).toContain("readonly API_KEY: string;");
      expect(dts).toContain('readonly "weird-name": string;');
      expect(dts).toContain("Project secret, managed in Settings → Secrets.");
    });

    /**
     * @scenario "Inputs and Outputs are typed from the node's fields"
     */
    it("types Inputs and Outputs from the node's fields", () => {
      expect(dts).toContain(
        "interface Inputs {\n  question: string;\n  count: number;\n  flags: boolean[];\n}",
      );
      expect(dts).toContain("interface Outputs {\n  answer: string;\n}");
    });

    /**
     * @scenario "Secret values never reach the editor"
     */
    it("never carries a secret's value into the declarations", () => {
      const withValues = { ...contract, secretValues: { API_KEY: "sk-live-0123456789" } };
      const text = buildJavaScriptRuntimeDts(withValues);
      expect(text).toContain("readonly API_KEY: string;");
      expect(text).not.toContain("sk-live-0123456789");
    });

    /**
     * @scenario "The declarations hold no DOM globals"
     */
    it("declares no DOM globals", () => {
      expect(dts).not.toMatch(/\b(document|window|XMLHttpRequest|localStorage)\b/);
    });
  });

  describe("given no secrets", () => {
    /**
     * @scenario "The secrets namespace completes when the project has no secrets"
     */
    it("still declares the secrets namespace so it completes", () => {
      const dts = buildJavaScriptRuntimeDts({ secretNames: [], inputs: [], outputs: [] });
      expect(dts).toContain("declare const secrets: {\n};");
    });
  });

  describe("given each studio field type", () => {
    /**
     * @scenario "Studio field types map to TypeScript"
     */
    it("maps studio field types to TypeScript", () => {
      expect(tsTypeFor({ type: "float" })).toBe("number");
      expect(tsTypeFor({ type: "dict" })).toBe("Record<string, unknown>");
      expect(tsTypeFor({ type: "image" })).toBe("unknown");
    });
  });
});

describe("a JavaScript code block checked against the runtime", () => {
  /**
   * @scenario "Runtime globals type-check"
   */
  it("accepts code that uses the runtime's globals", () => {
    const code = `/**
 * @param {Inputs} inputs
 * @returns {Promise<Outputs>}
 */
export default async function ({ question, count }) {
  const response = await fetch("https://example.com", { headers: { authorization: secrets.API_KEY } });
  const body = await response.json();
  console.log(body, response.headers.get("x"), count + 1, params.limit, btoa("x"));
  clearTimeout(setTimeout(() => undefined, 10));
  return { answer: question.toUpperCase() };
}
`;
    expect(diagnosticsFor({ code })).toEqual([]);
  });

  /**
   * @scenario "The JavaScript template type-checks against the runtime"
   */
  it("type-checks the default template", () => {
    const template = MODULES.code.parameters?.find((p) => p.identifier === "code")?.value as string;
    const diagnostics = diagnosticsFor({
      code: template.replace("({ input })", "({ question })").replace("output:", "answer:"),
    });
    expect(diagnostics).toEqual([]);
  });

  /**
   * @scenario "Secret names are offered for completion"
   */
  it("completes secret names and offers no DOM global", () => {
    const secretCode = "export default function () { return secrets.; }";
    const secretAt = secretCode.indexOf("secrets.") + "secrets.".length;
    const secretNames = serviceFor({ code: secretCode })
      .getCompletionsAtPosition(CODE_URI, secretAt, {})
      ?.entries.map((e) => e.name);
    expect(secretNames).toEqual(expect.arrayContaining(["API_KEY"]));

    const globalCode = "export default function () { d }";
    const globalAt = globalCode.indexOf("d }") + 1;
    const globals = serviceFor({ code: globalCode })
      .getCompletionsAtPosition(CODE_URI, globalAt, {})
      ?.entries.map((e) => e.name);
    expect(globals).toEqual(expect.arrayContaining(["fetch", "console", "secrets", "params"]));
    expect(globals).not.toContain("document");
    expect(globals).not.toContain("window");
  });

  /**
   * @scenario "DOM globals are flagged"
   * @scenario "An unknown secret is flagged"
   * @scenario "A wrong output type is flagged"
   */
  it("flags DOM globals, unknown secrets and wrong output types", () => {
    const code = `/** @returns {Outputs} */
export default function () {
  document.title = secrets.MISSING;
  return { answer: 1 };
}
`;
    const diagnostics = diagnosticsFor({ code }).join("\n");
    expect(diagnostics).toContain("Cannot find name 'document'");
    expect(diagnostics).toContain("Property 'MISSING' does not exist");
    expect(diagnostics).toContain("Type 'number' is not assignable to type 'string'");
  });
});

describe("a TypeScript code block checked against the runtime", () => {
  /**
   * @scenario "TypeScript is checked against the node's contract as you write"
   */
  it("type-checks the TypeScript template and flags a wrongly typed output", () => {
    const template = codeTemplate({ language: "typescript", input: "question", output: "answer" });
    expect(diagnosticsFor({ code: template, typescript: true })).toEqual([]);

    const wrong = template.replace('answer: "Hello world!"', "answer: 42");
    expect(diagnosticsFor({ code: wrong, typescript: true }).join("\n")).toMatch(
      /number.*not assignable to.*string/,
    );
  });
});
