import type { Monaco } from "@monaco-editor/react";
import type { editor, IDisposable, languages, IRange } from "monaco-editor";
import {
  PYTHON_BUILTINS,
  PYTHON_BUILTIN_BY_NAME,
  PYTHON_KEYWORDS,
  PYTHON_STDLIB_MODULES,
  PYTHON_STDLIB_MODULE_BY_NAME,
  PYTHON_STDLIB_MODULE_NAMES,
  type PyMember,
  type PyModule,
} from "./pythonStdlib";

/**
 * Bundle of disposables returned to the caller so a single component unmount
 * can tear down everything we registered globally on the Monaco instance.
 */
export interface PythonProviderHandle {
  dispose: () => void;
  /**
   * Update the editor's view of available secrets, inputs and outputs without
   * re-registering the underlying providers. The completion + validator
   * callbacks close over a mutable ref, so feeding fresh data is enough.
   */
  setContract: (next: PythonContract) => void;
}

export interface PythonField {
  identifier: string;
  type: string;
}

export interface PythonContract {
  secretNames: readonly string[];
  /** Inputs are bound as locals on the `input: str` argument of __call__. */
  inputs: readonly PythonField[];
  /** Outputs are expected as keys in the `return {...}` dict. */
  outputs: readonly PythonField[];
}

export interface RegisterPythonProvidersOptions {
  monaco: Monaco;
  contract: PythonContract;
}

interface ContractRef {
  current: PythonContract;
}

/**
 * Monaco's `CompletionItemInsertTextRule` is a flag enum; the runtime API
 * exposes the singular name (the plural is a long-standing source of
 * confusion across versions). Bypass the namespace lookup and use the numeric
 * value directly so we don't trip over const-enum erasure or version drift.
 *
 * See microsoft/monaco-editor monaco.d.ts:
 *   enum CompletionItemInsertTextRule { None = 0, KeepWhitespace = 1, InsertAsSnippet = 4 }
 */
const INSERT_AS_SNIPPET = 4;

function itemKind(
  monaco: Monaco,
  kind: PyMember["kind"],
): languages.CompletionItemKind {
  switch (kind) {
    case "function":
      return monaco.languages.CompletionItemKind.Function;
    case "class":
      return monaco.languages.CompletionItemKind.Class;
    case "constant":
      return monaco.languages.CompletionItemKind.Constant;
    case "method":
      return monaco.languages.CompletionItemKind.Method;
    case "property":
      return monaco.languages.CompletionItemKind.Property;
  }
}

function memberCompletion(
  monaco: Monaco,
  module: PyModule | null,
  member: PyMember,
  range: IRange,
): languages.CompletionItem {
  const label = member.name;
  const moduleHeader = module ? `${module.name}.${member.name}` : member.name;
  const sig = member.signature ?? label;
  const doc = member.doc ?? "";
  const isCallable = member.kind === "function" || member.kind === "method";
  return {
    label,
    kind: itemKind(monaco, member.kind),
    detail: sig,
    documentation: {
      value: `**${moduleHeader}**\n\n\`${sig}\`\n\n${doc}`,
    },
    insertText: isCallable ? `${label}($0)` : label,
    ...(isCallable ? { insertTextRules: INSERT_AS_SNIPPET } : {}),
    range,
  };
}

const IMPORT_MEMBER_PREFIX = /\bfrom\s+([\w.]+)\s+import\s+([\w,\s]*)$/;
const IMPORT_MODULE_PREFIX = /\b(?:import|from)\s+([\w.]*)$/;
const ATTR_ACCESS = /(\b[A-Za-z_][\w.]*?)\.([\w]*)$/;

/**
 * Marker codes — used both to tag diagnostics from the validator and to
 * match the same diagnostics in the code-action provider. Strings (vs
 * numbers) so they show up readably in the Problems panel.
 */
const MISSING_CLASS_CODE = "langwatch.missing-class-code";
const MISSING_CALL_CODE = "langwatch.missing-call-method";
const MISSING_OUTPUT_KEY = "langwatch.missing-output-key";
const MIXED_INDENT = "langwatch.mixed-indent";
const OUTPUT_TYPE_MISMATCH = "langwatch.output-type-mismatch";

type LiteralKind = "str" | "number" | "bool" | "list" | "dict" | "none";

/**
 * What literal kind would a value of this declared type look like, if the
 * user wrote a bare Python literal? Returns `null` for declared types where
 * "looks like X" doesn't carry enough signal to flag mismatches.
 */
function literalKindFor(type: string): LiteralKind | null {
  switch (type) {
    case "str":
    case "image":
      return "str";
    case "float":
    case "int":
      return "number";
    case "bool":
      return "bool";
    case "list":
      return "list";
    case "dict":
    case "json_schema":
      return "dict";
    default:
      return null;
  }
}

/** Classify a trimmed Python expression. Only recognises bare literals. */
function literalKindOf(expr: string): LiteralKind | null {
  const v = expr.trim();
  if (v === "None") return "none";
  if (v === "True" || v === "False") return "bool";
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return "number";
  if (
    /^(?:[rfubRFUB]{1,2})?["']/.test(v) &&
    /["']\s*$/.test(v)
  )
    return "str";
  if (v.startsWith("[") && v.endsWith("]")) return "list";
  if (v.startsWith("{") && v.endsWith("}")) return "dict";
  return null;
}

interface ParsedReturnDict {
  body: string;
  bodyStart: number;
}

/**
 * Locate the LAST top-level `return { … }` in source. Naive depth tracking
 * (good enough for code-node templates; doesn't try to handle return values
 * that are already inside another `{}`).
 */
function findLastReturnDict(source: string): ParsedReturnDict | null {
  const returnRe = /return\s*\{/g;
  let lastStart = -1;
  let lastBodyStart = -1;
  let m: RegExpExecArray | null;
  while ((m = returnRe.exec(source))) {
    lastStart = m.index;
    lastBodyStart = m.index + m[0].length;
  }
  if (lastStart === -1) return null;
  let depth = 1;
  let i = lastBodyStart;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { body: source.slice(lastBodyStart, i - 1), bodyStart: lastBodyStart };
}

interface DictEntry {
  key: string;
  value: string;
  valueOffset: number;
}

/**
 * Parse a dict body into top-level "key": value entries. String-aware so
 * commas inside literals don't split. Skips entries whose key isn't a bare
 * string literal — those are dynamic and we can't reason about them.
 */
function parseSimpleDictEntries(body: string): DictEntry[] {
  const entries: DictEntry[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s|,/.test(body[i] ?? "")) i++;
    if (i >= body.length) break;
    const keyQuote = body[i];
    if (keyQuote !== '"' && keyQuote !== "'") {
      // skip until comma at depth 0
      i = advancePastEntry(body, i);
      continue;
    }
    let j = i + 1;
    while (j < body.length && body[j] !== keyQuote) {
      if (body[j] === "\\") j++;
      j++;
    }
    if (j >= body.length) break;
    const key = body.slice(i + 1, j);
    j++;
    while (j < body.length && body[j] !== ":") j++;
    if (j >= body.length) break;
    j++; // past colon
    while (j < body.length && /\s/.test(body[j] ?? "")) j++;
    const valueStart = j;
    j = advancePastEntry(body, j);
    const value = body.slice(valueStart, j).trim();
    entries.push({ key, value, valueOffset: valueStart });
    i = j;
  }
  return entries;
}

function advancePastEntry(body: string, from: number): number {
  let depth = 0;
  let inStr: false | '"' | "'" = false;
  for (let k = from; k < body.length; k++) {
    const c = body[k];
    if (inStr) {
      if (c === "\\") {
        k++;
        continue;
      }
      if (c === inStr) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) return k;
  }
  return body.length;
}

/**
 * Map a declared output type → a sensible Python literal default. Used in
 * completion snippets and the quick-fix that inserts a missing key, so the
 * user gets a value that already matches what the runtime expects.
 */
function defaultValueLiteralFor(type: string): string {
  switch (type) {
    case "str":
      return '""';
    case "float":
      return "0.0";
    case "int":
      return "0";
    case "bool":
      return "False";
    case "list":
      return "[]";
    case "dict":
    case "json_schema":
      return "{}";
    case "image":
      // images are usually a URL string in code nodes
      return '""';
    default:
      return "None";
  }
}

const CODE_SCAFFOLD_SNIPPET = [
  "class Code:",
  "    def __call__(self, input: str):",
  '        return {"output": "Hello world!"}',
  "",
].join("\n");

const CALL_METHOD_SNIPPET = [
  "    def __call__(self, input: str):",
  '        return {"output": "Hello world!"}',
  "",
].join("\n");

/**
 * Track which stdlib modules have been imported (via `import X` or `from X
 * import …`) so attribute access on them resolves to real member lists.
 *
 * Returns a map of bound-name -> module so `import X as Y` resolves `Y.foo`
 * to module X. Only top-level stdlib modules are tracked; user-defined names
 * fall back to generic identifier completion.
 */
function scanImports(source: string): Map<string, PyModule> {
  const map = new Map<string, PyModule>();
  const importRe =
    /^(?:[ \t]*)(?:import|from)\s+([\w.]+)(?:\s+as\s+(\w+))?(?:\s+import\s+([\w,\s*]+))?/gm;
  for (const match of source.matchAll(importRe)) {
    const moduleName = match[1];
    const alias = match[2];
    if (!moduleName) continue;
    const mod = PYTHON_STDLIB_MODULE_BY_NAME.get(moduleName);
    if (!mod) continue;
    map.set(alias ?? moduleName.split(".").pop() ?? moduleName, mod);
  }
  return map;
}

function registerCompletion(
  monaco: Monaco,
  contractRef: ContractRef,
): IDisposable {
  return monaco.languages.registerCompletionItemProvider("python", {
    // Only trigger on `.` for attribute access. Triggering on space pops the
    // suggest widget on every whitespace and (in some browsers) intercepts the
    // space keystroke entirely. Users can still invoke explicitly with
    // Ctrl+Space / Cmd+I.
    triggerCharacters: ["."],
    provideCompletionItems: (model, position) => {
      const lineBefore = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const word = model.getWordUntilPosition(position);
      const replaceRange: IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      // `from X import Y` -> suggest module members of X.
      const importMemberMatch = IMPORT_MEMBER_PREFIX.exec(lineBefore);
      if (importMemberMatch) {
        const moduleName = importMemberMatch[1];
        const mod = moduleName
          ? PYTHON_STDLIB_MODULE_BY_NAME.get(moduleName)
          : undefined;
        if (mod) {
          return {
            suggestions: mod.members.map((m) =>
              memberCompletion(monaco, mod, m, replaceRange),
            ),
          };
        }
      }

      // `import X` / `from X` -> suggest module names.
      const importMatch = IMPORT_MODULE_PREFIX.exec(lineBefore);
      if (importMatch) {
        return {
          suggestions: PYTHON_STDLIB_MODULE_NAMES.map((name) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Module,
            detail: PYTHON_STDLIB_MODULE_BY_NAME.get(name)?.doc ?? "",
            insertText: name,
            range: replaceRange,
          })),
        };
      }

      // `secrets.` -> suggest secret names as str-typed constants.
      // `<module>.` -> suggest module members.
      const attrMatch = ATTR_ACCESS.exec(lineBefore);
      if (attrMatch) {
        const owner = attrMatch[1];
        if (!owner) {
          return { suggestions: [] };
        }
        if (owner === "secrets") {
          return {
            suggestions: contractRef.current.secretNames.map((name) => ({
              label: name,
              kind: monaco.languages.CompletionItemKind.Constant,
              detail: "str",
              documentation: {
                value: `**secrets.${name}**\n\nProject secret. Injected at runtime as a string — managed in Settings → Secrets.`,
              },
              insertText: name,
              range: replaceRange,
              sortText: `0_${name}`,
            })),
          };
        }
        const imports = scanImports(model.getValue());
        const mod = imports.get(owner);
        if (mod) {
          return {
            suggestions: mod.members.map((m) =>
              memberCompletion(monaco, mod, m, replaceRange),
            ),
          };
        }
        return { suggestions: [] };
      }

      // Default surface: builtins, keywords, imported modules, node inputs,
      // and a discoverable `secrets` handle.
      const imports = scanImports(model.getValue());
      const importedNames = Array.from(imports.keys());
      const suggestions: languages.CompletionItem[] = [
        ...PYTHON_BUILTINS.map((b) => {
          const isCallable = b.kind === "function";
          return {
            label: b.name,
            kind: itemKind(monaco, b.kind),
            detail: b.signature ?? "",
            documentation: { value: b.doc ?? "" },
            insertText: isCallable ? `${b.name}($0)` : b.name,
            ...(isCallable ? { insertTextRules: INSERT_AS_SNIPPET } : {}),
            range: replaceRange,
          };
        }),
        ...PYTHON_KEYWORDS.map((kw) => ({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range: replaceRange,
        })),
        ...importedNames.map((name) => ({
          label: name,
          kind: monaco.languages.CompletionItemKind.Module,
          detail: imports.get(name)?.doc ?? "",
          insertText: name,
          range: replaceRange,
        })),
        // Node inputs — bound as locals from the `input` arg dict in the
        // runtime adapter. Sort them to the top so users discover the contract.
        ...contractRef.current.inputs.map((field) => ({
          label: field.identifier,
          kind: monaco.languages.CompletionItemKind.Variable,
          detail: field.type,
          documentation: {
            value: `**${field.identifier}**: \`${field.type}\`\n\nNode input. Wired in the properties panel.`,
          },
          insertText: field.identifier,
          range: replaceRange,
          sortText: `0_input_${field.identifier}`,
        })),
      ];

      // `secrets` itself is always discoverable from a fresh buffer.
      if (contractRef.current.secretNames.length > 0) {
        suggestions.push({
          label: "secrets",
          kind: monaco.languages.CompletionItemKind.Variable,
          detail: "SimpleNamespace",
          documentation: {
            value: `Project secrets namespace. Access with \`secrets.NAME\`.\n\n${contractRef.current.secretNames.length} secret${contractRef.current.secretNames.length === 1 ? "" : "s"} available.`,
          },
          insertText: "secrets",
          range: replaceRange,
          sortText: "0_secrets",
        });
      }

      // Suggest output keys when the user is mid-dict-literal or returning.
      // Cheap detection: if the surrounding text on/before this line looks
      // like a return dict, offer the declared outputs as string-key snippets.
      const wantsKey =
        /\breturn\s*\{[^}]*$/.test(lineBefore) ||
        /\{[^}]*$/.test(lineBefore.trimStart());
      if (wantsKey) {
        for (const field of contractRef.current.outputs) {
          const defaultLit = defaultValueLiteralFor(field.type);
          suggestions.push({
            label: `"${field.identifier}"`,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `${field.type}  →  ${defaultLit}`,
            documentation: {
              value: `Declared node output **${field.identifier}**: \`${field.type}\`. Inserted with a \`${defaultLit}\` default placeholder so the value already matches the declared type.`,
            },
            insertText: `"${field.identifier}": \${0:${defaultLit}}`,
            insertTextRules: INSERT_AS_SNIPPET,
            range: replaceRange,
            sortText: `0_output_${field.identifier}`,
          });
        }
      }

      return { suggestions };
    },
  });
}

function registerHover(monaco: Monaco, contractRef: ContractRef): IDisposable {
  return monaco.languages.registerHoverProvider("python", {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const lineBefore = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const attr = ATTR_ACCESS.exec(`${lineBefore}${word.word}`);
      if (attr) {
        const owner = attr[1];
        const name = attr[2];
        if (!owner || !name) return null;
        // `secrets.NAME` — show the secret name, its runtime type, and a
        // reminder of where it's managed.
        if (owner === "secrets") {
          const known = contractRef.current.secretNames.includes(name);
          return {
            contents: [
              { value: `**secrets.${name}**` },
              { value: "```python\n" + `secrets.${name}: str\n` + "```" },
              {
                value: known
                  ? "Project secret. Injected at runtime as a string — managed in Settings → Secrets."
                  : `⚠️ No secret named \`${name}\` is configured. Add it under Settings → Secrets, or fix the name.`,
              },
            ],
          };
        }
        const imports = scanImports(model.getValue());
        const mod = imports.get(owner);
        const member = mod?.members.find((m) => m.name === name);
        if (mod && member) {
          return {
            contents: [
              { value: `**${mod.name}.${member.name}**` },
              {
                value:
                  "```python\n" + (member.signature ?? member.name) + "\n```",
              },
              { value: member.doc ?? "" },
            ],
          };
        }
      }
      // Bare identifier — node input, output, or builtin (in that order).
      const input = contractRef.current.inputs.find(
        (f) => f.identifier === word.word,
      );
      if (input) {
        return {
          contents: [
            { value: `**${input.identifier}** *(node input)*` },
            { value: "```python\n" + `${input.identifier}: ${input.type}\n` + "```" },
            { value: "Wired in the Inputs section of the properties panel." },
          ],
        };
      }
      const output = contractRef.current.outputs.find(
        (f) => f.identifier === word.word,
      );
      if (output) {
        return {
          contents: [
            { value: `**${output.identifier}** *(node output)*` },
            {
              value:
                "```python\n" + `${output.identifier}: ${output.type}\n` + "```",
            },
            {
              value:
                "Declared in the Outputs section — return it as a key in the `__call__` dict.",
            },
          ],
        };
      }
      if (word.word === "secrets") {
        const count = contractRef.current.secretNames.length;
        return {
          contents: [
            { value: "**secrets** *(project secrets namespace)*" },
            { value: "```python\nsecrets: SimpleNamespace\n```" },
            {
              value: `Access with \`secrets.NAME\`. ${count} secret${count === 1 ? "" : "s"} available.`,
            },
          ],
        };
      }
      const builtin = PYTHON_BUILTIN_BY_NAME.get(word.word);
      if (builtin) {
        return {
          contents: [
            { value: `**${builtin.name}**` },
            {
              value:
                "```python\n" + (builtin.signature ?? builtin.name) + "\n```",
            },
            { value: builtin.doc ?? "" },
          ],
        };
      }
      return null;
    },
  });
}

/**
 * Pop the parameter-hint widget when the user opens a call expression. Resolves
 * the callee against the same catalogue the hover provider uses (builtins
 * + stdlib + imported modules). Re-triggers on commas so multi-arg calls keep
 * the hint visible.
 */
function registerSignatureHelp(monaco: Monaco): IDisposable {
  const CALLEE_BEFORE_PAREN = /([A-Za-z_][\w.]*)\s*\($/;
  return monaco.languages.registerSignatureHelpProvider("python", {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp: (model, position) => {
      const lineBefore = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      // Find the nearest unclosed `(` on the current line so we can resolve
      // which call we're inside (handles `foo(bar(baz, |))` chains).
      let depth = 0;
      let openIdx = -1;
      for (let i = lineBefore.length - 1; i >= 0; i--) {
        const ch = lineBefore[i];
        if (ch === ")") depth++;
        else if (ch === "(") {
          if (depth === 0) {
            openIdx = i;
            break;
          }
          depth--;
        }
      }
      if (openIdx === -1) return null;

      const beforeOpen = lineBefore.slice(0, openIdx + 1);
      const calleeMatch = CALLEE_BEFORE_PAREN.exec(beforeOpen);
      if (!calleeMatch) return null;
      const callee = calleeMatch[1];
      if (!callee) return null;

      // Resolve callee → catalogue entry.
      let entry: PyMember | undefined;
      let label: string | undefined;
      if (callee.includes(".")) {
        const [owner, ...rest] = callee.split(".");
        const memberName = rest.join(".");
        if (owner === undefined) return null;
        const imports = scanImports(model.getValue());
        const mod = imports.get(owner);
        if (mod) {
          entry = mod.members.find((m) => m.name === memberName);
          if (entry) label = `${mod.name}.${entry.name}`;
        }
      } else {
        entry = PYTHON_BUILTIN_BY_NAME.get(callee);
        if (entry) label = entry.name;
      }
      if (!entry || !entry.signature) return null;

      const sigLabel = entry.signature ?? label ?? callee;
      // Cheap parameter slice: anything between the first `(` and the matching `)`.
      const paramListMatch = /\(([^)]*)\)/.exec(sigLabel);
      const params = paramListMatch
        ? paramListMatch[1]
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
            .map((p) => ({ label: p }))
        : [];
      const activeArgIdx = lineBefore
        .slice(openIdx + 1)
        .split(",").length - 1;

      return {
        value: {
          signatures: [
            {
              label: sigLabel,
              documentation: entry.doc ?? "",
              parameters: params,
            },
          ],
          activeSignature: 0,
          activeParameter: Math.min(activeArgIdx, Math.max(0, params.length - 1)),
        },
        dispose: () => undefined,
      };
    },
  });
}

/**
 * Heuristic Python formatter — re-indents to multiples of 4 spaces, trims
 * trailing whitespace, and collapses runs of 3+ blank lines into 2. We do not
 * try to match Black; the goal is consistent in-editor hygiene without
 * depending on a server round-trip.
 */
function registerFormatter(monaco: Monaco): IDisposable {
  return monaco.languages.registerDocumentFormattingEditProvider("python", {
    provideDocumentFormattingEdits: (model) => {
      const source = model.getValue();
      const lines = source.split("\n");

      const detab = (line: string): string => {
        let indent = 0;
        let i = 0;
        while (i < line.length) {
          const ch = line[i];
          if (ch === " ") {
            indent += 1;
          } else if (ch === "\t") {
            indent += 4 - (indent % 4);
          } else {
            break;
          }
          i += 1;
        }
        const rest = line.slice(i).replace(/[ \t]+$/, "");
        if (rest.length === 0) return "";
        return " ".repeat(indent) + rest;
      };

      const formatted: string[] = [];
      let blankRun = 0;
      for (const line of lines) {
        const out = detab(line);
        if (out.length === 0) {
          blankRun += 1;
          if (blankRun <= 2) formatted.push("");
        } else {
          blankRun = 0;
          formatted.push(out);
        }
      }
      while (formatted.length > 0 && formatted[0] === "") formatted.shift();
      while (formatted.length > 0 && formatted[formatted.length - 1] === "") {
        formatted.pop();
      }
      const next = formatted.join("\n") + "\n";

      if (next === source) return [];
      return [
        {
          range: model.getFullModelRange(),
          text: next,
        },
      ];
    },
  });
}

/**
 * Lightweight client-side validator — flags mismatched brackets, unterminated
 * strings, tabs-after-spaces indentation, and (when the node has declared
 * outputs) any output keys missing from the user's `return {...}` dict. Not a
 * full Python parser; it catches the structural mistakes users hit most
 * without a server round-trip.
 */
function registerValidator(
  monaco: Monaco,
  contractRef: ContractRef,
): IDisposable {
  const owner = "langwatch-python-lint";

  const validate = (model: editor.ITextModel): void => {
    if (model.getLanguageId() !== "python") return;
    const markers: editor.IMarkerData[] = [];
    const source = model.getValue();
    const lines = source.split("\n");

    const stack: { ch: string; line: number; col: number }[] = [];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    let inString: false | '"' | "'" | '"""' | "'''" = false;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx] ?? "";
      let col = 0;
      while (col < line.length) {
        const ch = line[col];
        const next2 = line.slice(col, col + 3);

        if (inString) {
          if (
            (inString === '"""' || inString === "'''") &&
            next2 === inString
          ) {
            inString = false;
            col += 3;
            continue;
          }
          if ((inString === '"' || inString === "'") && ch === inString) {
            inString = false;
            col += 1;
            continue;
          }
          if (ch === "\\") {
            col += 2;
            continue;
          }
          col += 1;
          continue;
        }

        if (ch === "#") break;

        if (next2 === '"""' || next2 === "'''") {
          inString = next2 as '"""' | "'''";
          col += 3;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inString = ch;
          col += 1;
          continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") {
          stack.push({ ch, line: lineIdx, col });
        } else if (ch === ")" || ch === "]" || ch === "}") {
          const expected = pairs[ch];
          const top = stack[stack.length - 1];
          if (!top || top.ch !== expected) {
            markers.push({
              severity: monaco.MarkerSeverity.Error,
              message: `Unmatched closing '${ch}'`,
              startLineNumber: lineIdx + 1,
              startColumn: col + 1,
              endLineNumber: lineIdx + 1,
              endColumn: col + 2,
            });
          } else {
            stack.pop();
          }
        }
        col += 1;
      }

      if (inString === '"' || inString === "'") {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: `Unterminated string literal`,
          startLineNumber: lineIdx + 1,
          startColumn: 1,
          endLineNumber: lineIdx + 1,
          endColumn: line.length + 1,
        });
        inString = false;
      }

      const leading = /^([ \t]+)/.exec(line);
      if (leading && /\t/.test(leading[1] ?? "") && / /.test(leading[1] ?? "")) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          code: MIXED_INDENT,
          message: "Mixed tabs and spaces in indentation",
          startLineNumber: lineIdx + 1,
          startColumn: 1,
          endLineNumber: lineIdx + 1,
          endColumn: (leading[1]?.length ?? 0) + 1,
        });
      }
    }

    if (inString === '"""' || inString === "'''") {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: "Unterminated triple-quoted string",
        startLineNumber: lines.length,
        startColumn: 1,
        endLineNumber: lines.length,
        endColumn: (lines[lines.length - 1]?.length ?? 0) + 1,
      });
    }

    for (const open of stack) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: `Unclosed '${open.ch}'`,
        startLineNumber: open.line + 1,
        startColumn: open.col + 1,
        endLineNumber: open.line + 1,
        endColumn: open.col + 2,
      });
    }

    // Required scaffold — the workflow runtime invokes `Code().__call__(input)`
    // so the user code must define a `Code` class with a `__call__` method.
    // Surface a real Error marker if either piece is missing so accidental
    // deletion fails fast in-editor instead of at run time. The `code` field
    // doubles as the quick-fix discriminator (see registerCodeActions below).
    if (!/\bclass\s+Code\b/.test(source)) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        code: MISSING_CLASS_CODE,
        message:
          "Missing `class Code:` declaration — the workflow runtime calls `Code().__call__(input)`. Add it back so the node can execute.",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
      });
    } else if (!/\bdef\s+__call__\s*\(/.test(source)) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        code: MISSING_CALL_CODE,
        message:
          "Missing `def __call__(self, input: str):` on `class Code` — the workflow runtime invokes it to run the node.",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
      });
    }

    // Output contract — warn when a declared output is never referenced as a
    // string key in the source. Cheap: matches `"name"` or `'name'`. Misses
    // dynamic key construction, which is rare in code nodes.
    const declaredOutputs = contractRef.current.outputs;
    if (declaredOutputs.length > 0) {
      for (const field of declaredOutputs) {
        const escaped = field.identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const keyRe = new RegExp(`["']${escaped}["']`);
        if (!keyRe.test(source)) {
          markers.push({
            severity: monaco.MarkerSeverity.Warning,
            code: `${MISSING_OUTPUT_KEY}:${field.identifier}`,
            message: `Declared output "${field.identifier}" (${field.type}) is never set — make sure your return dict includes it.`,
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 2,
          });
        }
      }

      // Cheap literal-type-mismatch lint. Walk the last `return {…}` dict on
      // the source and, for each declared output that has an obviously-typed
      // literal value (string, number, bool, list, dict), warn when the
      // literal kind doesn't match the declared type. Variable references and
      // function calls fall through unchecked — too many false positives
      // without a real Python parser.
      const lastReturn = findLastReturnDict(source);
      if (lastReturn) {
        const entries = parseSimpleDictEntries(lastReturn.body);
        for (const entry of entries) {
          const declared = declaredOutputs.find(
            (o) => o.identifier === entry.key,
          );
          if (!declared) continue;
          const expectedKind = literalKindFor(declared.type);
          const actualKind = literalKindOf(entry.value);
          if (actualKind && expectedKind && actualKind !== expectedKind) {
            const valueOffset = lastReturn.bodyStart + entry.valueOffset;
            const startPos = model.getPositionAt(valueOffset);
            const endPos = model.getPositionAt(
              valueOffset + entry.value.length,
            );
            markers.push({
              severity: monaco.MarkerSeverity.Warning,
              code: `${OUTPUT_TYPE_MISMATCH}:${entry.key}`,
              message: `Declared output "${entry.key}" expects ${declared.type} but the return value looks like ${actualKind}.`,
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            });
          }
        }
      }
    }

    monaco.editor.setModelMarkers(model, owner, markers);
  };

  const onChangeDisposers: IDisposable[] = [];
  const onCreate = monaco.editor.onDidCreateModel((model) => {
    validate(model);
    onChangeDisposers.push(model.onDidChangeContent(() => validate(model)));
  });
  for (const model of monaco.editor.getModels()) {
    validate(model);
    onChangeDisposers.push(model.onDidChangeContent(() => validate(model)));
  }
  return {
    dispose: () => {
      onCreate.dispose();
      for (const d of onChangeDisposers) d.dispose();
      for (const model of monaco.editor.getModels()) {
        monaco.editor.setModelMarkers(model, owner, []);
      }
    },
    // Also re-run validation when the contract changes externally.
    // (Caller invokes this via setContract.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as IDisposable & { revalidate?: () => void };
}

/**
 * Quick fixes for the scaffold-missing diagnostics. Monaco renders the
 * lightbulb on lines that have a matching marker; clicking it offers the
 * actions we return from here.
 */
function registerCodeActions(
  monaco: Monaco,
  contractRef: ContractRef,
): IDisposable {
  return monaco.languages.registerCodeActionProvider("python", {
    provideCodeActions: (model, _range, context) => {
      const actions: languages.CodeAction[] = [];
      const matching = context.markers.filter((m) => {
        const c = typeof m.code === "string" ? m.code : m.code?.value;
        return (
          c === MISSING_CLASS_CODE ||
          c === MISSING_CALL_CODE ||
          c === MIXED_INDENT ||
          (typeof c === "string" && c.startsWith(MISSING_OUTPUT_KEY))
        );
      });
      if (matching.length === 0) {
        return { actions: [], dispose: () => undefined };
      }
      const fullRange = model.getFullModelRange();
      const source = model.getValue();
      const hasTrailingNewline = source.length === 0 || source.endsWith("\n");

      for (const marker of matching) {
        const markerCode =
          typeof marker.code === "string" ? marker.code : marker.code?.value;
        if (markerCode === MISSING_CLASS_CODE) {
          // Prepend the full class scaffold to the existing buffer so any
          // helper imports the user has at the top are preserved.
          const text = hasTrailingNewline
            ? CODE_SCAFFOLD_SNIPPET
            : "\n" + CODE_SCAFFOLD_SNIPPET;
          actions.push({
            title: "Insert `class Code` scaffold",
            kind: "quickfix",
            diagnostics: [marker],
            isPreferred: true,
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: {
                      startLineNumber: fullRange.endLineNumber,
                      endLineNumber: fullRange.endLineNumber,
                      startColumn: fullRange.endColumn,
                      endColumn: fullRange.endColumn,
                    },
                    text,
                  },
                },
              ],
            },
          });
        } else if (markerCode === MISSING_CALL_CODE) {
          // Insert the __call__ method on the line AFTER `class Code:`. If we
          // can't locate the class line, fall back to appending at the end of
          // the document.
          const lineCount = model.getLineCount();
          let insertLine = lineCount;
          for (let i = 1; i <= lineCount; i++) {
            if (/\bclass\s+Code\b/.test(model.getLineContent(i))) {
              insertLine = i + 1;
              break;
            }
          }
          actions.push({
            title: "Insert `__call__` method",
            kind: "quickfix",
            diagnostics: [marker],
            isPreferred: true,
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: {
                      startLineNumber: insertLine,
                      endLineNumber: insertLine,
                      startColumn: 1,
                      endColumn: 1,
                    },
                    text: CALL_METHOD_SNIPPET,
                  },
                },
              ],
            },
          });
        } else if (
          typeof markerCode === "string" &&
          markerCode.startsWith(MISSING_OUTPUT_KEY + ":")
        ) {
          // Add `"name": <typed default>` to the last `return { ... }` dict on
          // the class. If we can't find one, no-op (the user can use the
          // scaffold quick fix to land them in a known state first).
          const outputName = markerCode.slice(MISSING_OUTPUT_KEY.length + 1);
          const outputType =
            contractRef.current.outputs.find(
              (o) => o.identifier === outputName,
            )?.type ?? "str";
          const defaultLit = defaultValueLiteralFor(outputType);
          const returnRe = /(return\s*\{)([^}]*)\}/g;
          let lastMatch: RegExpExecArray | null = null;
          let m: RegExpExecArray | null;
          while ((m = returnRe.exec(source))) lastMatch = m;
          if (lastMatch) {
            const matchStart = lastMatch.index;
            const dictBodyStart = matchStart + (lastMatch[1]?.length ?? 0);
            const body = lastMatch[2] ?? "";
            const insertOffset = dictBodyStart + body.length;
            const startPos = model.getPositionAt(insertOffset);
            const sep = body.trim().length > 0 && !body.trimEnd().endsWith(",")
              ? ", "
              : body.trim().length > 0
                ? " "
                : "";
            actions.push({
              title: `Add "${outputName}" (${outputType}) to return dict`,
              kind: "quickfix",
              diagnostics: [marker],
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: {
                        startLineNumber: startPos.lineNumber,
                        endLineNumber: startPos.lineNumber,
                        startColumn: startPos.column,
                        endColumn: startPos.column,
                      },
                      text: `${sep}"${outputName}": ${defaultLit}`,
                    },
                  },
                ],
              },
            });
          }
        } else if (markerCode === MIXED_INDENT) {
          // Use the formatter's detab logic inline: replace just this line's
          // leading whitespace with 4-space columns.
          const lineNo = marker.startLineNumber;
          const line = model.getLineContent(lineNo);
          const leading = /^([ \t]+)/.exec(line)?.[1] ?? "";
          let indent = 0;
          for (const ch of leading) {
            indent += ch === "\t" ? 4 - (indent % 4) : 1;
          }
          actions.push({
            title: "Normalize indentation to spaces",
            kind: "quickfix",
            diagnostics: [marker],
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: {
                      startLineNumber: lineNo,
                      endLineNumber: lineNo,
                      startColumn: 1,
                      endColumn: leading.length + 1,
                    },
                    text: " ".repeat(indent),
                  },
                },
              ],
            },
          });
        }
      }
      void contractRef; // referenced in case future quick-fixes need it
      return { actions, dispose: () => undefined };
    },
  });
}

/**
 * Register all Monaco providers used by the workflow Python editor. Returns
 * a single handle whose `dispose()` tears everything down — call it on
 * editor unmount to avoid leaking globally-registered providers across
 * remounts.
 */
export function registerPythonProviders({
  monaco,
  contract,
}: RegisterPythonProvidersOptions): PythonProviderHandle {
  const contractRef: ContractRef = { current: contract };
  const completionDisposer = registerCompletion(monaco, contractRef);
  const hoverDisposer = registerHover(monaco, contractRef);
  const formatterDisposer = registerFormatter(monaco);
  const validatorDisposer = registerValidator(monaco, contractRef);
  const codeActionsDisposer = registerCodeActions(monaco, contractRef);
  const signatureHelpDisposer = registerSignatureHelp(monaco);

  // Re-run validation when the contract changes so output-missing markers
  // update immediately rather than waiting for the next keystroke.
  const revalidate = () => {
    for (const model of monaco.editor.getModels()) {
      if (model.getLanguageId() !== "python") continue;
      // Force a no-op content event to re-trigger the validator via
      // onDidChangeContent listeners. Cheaper than introspecting internals.
      const value = model.getValue();
      if (value.length > 0) {
        // Use applyEdits with a zero-text edit at end-of-document to fire
        // change listeners without altering content.
        const last = model.getFullModelRange().getEndPosition();
        model.applyEdits([
          {
            range: {
              startLineNumber: last.lineNumber,
              startColumn: last.column,
              endLineNumber: last.lineNumber,
              endColumn: last.column,
            },
            text: "",
          },
        ]);
      }
    }
  };

  return {
    dispose: () => {
      completionDisposer.dispose();
      hoverDisposer.dispose();
      formatterDisposer.dispose();
      validatorDisposer.dispose();
      codeActionsDisposer.dispose();
      signatureHelpDisposer.dispose();
    },
    setContract: (next) => {
      contractRef.current = next;
      revalidate();
    },
  };
}
