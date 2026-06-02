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
          suggestions.push({
            label: `"${field.identifier}"`,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: field.type,
            documentation: {
              value: `Declared node output **${field.identifier}**: \`${field.type}\``,
            },
            insertText: `"${field.identifier}": $0`,
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

function registerHover(monaco: Monaco): IDisposable {
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
            message: `Declared output "${field.identifier}" (${field.type}) is never set — make sure your return dict includes it.`,
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 2,
          });
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
  const hoverDisposer = registerHover(monaco);
  const formatterDisposer = registerFormatter(monaco);
  const validatorDisposer = registerValidator(monaco, contractRef);

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
    },
    setContract: (next) => {
      contractRef.current = next;
      revalidate();
    },
  };
}
