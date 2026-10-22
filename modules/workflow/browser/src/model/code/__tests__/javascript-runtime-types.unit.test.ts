import { libFileMap } from "monaco-editor/esm/vs/language/typescript/lib/lib.js";
import { typescript as ts } from "monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js";
import { describe, expect, it } from "vitest";

import { MODULES } from "../../studio-registry.ts";
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

/** Runs Monaco's own TypeScript over one code block, hosted the way its JS worker hosts it. */
function diagnosticsFor({ code }: { code: string }): string[] {
  const files = new Map([
    [CODE_URI, code],
    [RUNTIME_URI, buildJavaScriptRuntimeDts(contract)],
  ]);
  const read = (name: string) => files.get(name) ?? libText(name);
  const service = ts.createLanguageService({
    getCompilationSettings: () => codeBlockCompilerOptions({ enums: ts }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const text = read(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getScriptKind: (name) => (name === CODE_URI ? ts.ScriptKind.JS : ts.ScriptKind.TS),
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "lib.es2023.d.ts",
    fileExists: (name) => read(name) !== undefined,
    readFile: read,
  });
  return [
    ...service.getSyntacticDiagnostics(CODE_URI),
    ...service.getSemanticDiagnostics(CODE_URI),
  ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("buildJavaScriptRuntimeDts", () => {
  describe("given secrets, inputs and outputs", () => {
    const dts = buildJavaScriptRuntimeDts(contract);

    it("declares each secret as a documented readonly string", () => {
      expect(dts).toContain("readonly API_KEY: string;");
      expect(dts).toContain('readonly "weird-name": string;');
      expect(dts).toContain("Project secret, managed in Settings → Secrets.");
    });

    it("types Inputs and Outputs from the node's fields", () => {
      expect(dts).toContain(
        "interface Inputs {\n  question: string;\n  count: number;\n  flags: boolean[];\n}",
      );
      expect(dts).toContain("interface Outputs {\n  answer: string;\n}");
    });

    it("declares no DOM globals", () => {
      expect(dts).not.toMatch(/\b(document|window|XMLHttpRequest|localStorage)\b/);
    });
  });

  describe("given no secrets", () => {
    it("still declares the secrets namespace so it completes", () => {
      const dts = buildJavaScriptRuntimeDts({ secretNames: [], inputs: [], outputs: [] });
      expect(dts).toContain("declare const secrets: {\n};");
    });
  });

  describe("given each studio field type", () => {
    it("maps studio field types to TypeScript", () => {
      expect(tsTypeFor({ type: "float" })).toBe("number");
      expect(tsTypeFor({ type: "dict" })).toBe("Record<string, unknown>");
      expect(tsTypeFor({ type: "image" })).toBe("unknown");
    });
  });
});

describe("a JavaScript code block checked against the runtime", () => {
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

  it("type-checks the default template", () => {
    const template = MODULES.code.parameters?.find((p) => p.identifier === "code")?.value as string;
    const diagnostics = diagnosticsFor({
      code: template.replace("({ input })", "({ question })").replace("output:", "answer:"),
    });
    expect(diagnostics).toEqual([]);
  });

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
