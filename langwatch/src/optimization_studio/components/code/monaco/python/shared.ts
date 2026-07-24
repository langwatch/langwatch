import { PYTHON_STDLIB_MODULE_BY_NAME, type PyModule } from "../pythonStdlib";

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

export interface ContractRef {
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
export const INSERT_AS_SNIPPET = 4;

export const IMPORT_MEMBER_PREFIX = /\bfrom\s+([\w.]+)\s+import\s+([\w,\s]*)$/;
export const IMPORT_MODULE_PREFIX = /\b(?:import|from)\s+([\w.]*)$/;
export const ATTR_ACCESS = /(\b[A-Za-z_][\w.]*?)\.([\w]*)$/;

/**
 * Marker codes — used both to tag diagnostics from the validator and to
 * match the same diagnostics in the code-action provider. Strings (vs
 * numbers) so they show up readably in the Problems panel.
 */
export const MISSING_CLASS_CODE = "langwatch.missing-class-code";
export const MISSING_CALL_CODE = "langwatch.missing-call-method";
export const MISSING_OUTPUT_KEY = "langwatch.missing-output-key";
export const MIXED_INDENT = "langwatch.mixed-indent";
export const OUTPUT_TYPE_MISMATCH = "langwatch.output-type-mismatch";

export type LiteralKind =
  | "str"
  | "number"
  | "bool"
  | "list"
  | "dict"
  | "none";

/**
 * What literal kind would a value of this declared type look like, if the
 * user wrote a bare Python literal? Returns `null` for declared types where
 * "looks like X" doesn't carry enough signal to flag mismatches.
 */
export function literalKindFor(type: string): LiteralKind | null {
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
export function literalKindOf(expr: string): LiteralKind | null {
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

export interface ParsedReturnDict {
  body: string;
  bodyStart: number;
}

/**
 * Locate the LAST top-level `return { … }` in source. Naive depth tracking
 * (good enough for code-node templates; doesn't try to handle return values
 * that are already inside another `{}`).
 */
export function findLastReturnDict(source: string): ParsedReturnDict | null {
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

export interface DictEntry {
  key: string;
  value: string;
  valueOffset: number;
}

/**
 * Parse a dict body into top-level "key": value entries. String-aware so
 * commas inside literals don't split. Skips entries whose key isn't a bare
 * string literal — those are dynamic and we can't reason about them.
 */
export function parseSimpleDictEntries(body: string): DictEntry[] {
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
export function defaultValueLiteralFor(type: string): string {
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

export const CODE_SCAFFOLD_SNIPPET = [
  "class Code:",
  "    def __call__(self, input: str):",
  '        return {"output": "Hello world!"}',
  "",
].join("\n");

export const CALL_METHOD_SNIPPET = [
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
export function scanImports(source: string): Map<string, PyModule> {
  const map = new Map<string, PyModule>();
  const importRe =
    /^(?:[ \t]*)(import|from)\s+([\w.]+)(?:\s+as\s+(\w+))?(?:\s+import\s+([\w,\s*]+))?/gm;
  for (const match of source.matchAll(importRe)) {
    const kind = match[1];
    const moduleName = match[2];
    const alias = match[3];
    if (!moduleName) continue;
    const mod = PYTHON_STDLIB_MODULE_BY_NAME.get(moduleName);
    if (!mod) continue;
    if (kind === "import") {
      // `import urllib.parse` binds the full dotted name; `urllib.parse.foo`
      // therefore needs to look up the dotted owner, not just the leaf.
      // `import X as Y` binds only the alias.
      map.set(alias ?? moduleName, mod);
    } else if (alias) {
      // `from X import …` only binds the alias for the imported member; the
      // module itself is not bound at all unless the user wrote
      // `from X import Y as Z` with an `as` clause on the module… which is
      // not legal Python. Skip when no alias.
      map.set(alias, mod);
    }
  }
  return map;
}
