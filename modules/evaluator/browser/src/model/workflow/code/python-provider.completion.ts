import type { Monaco } from "@monaco-editor/react";
import type { editor, IDisposable, IRange, languages, Position } from "monaco-editor";

import {
  ATTR_ACCESS,
  type ContractRef,
  defaultValueLiteralFor,
  IMPORT_MEMBER_PREFIX,
  IMPORT_MODULE_PREFIX,
  INSERT_AS_SNIPPET,
  scanImports,
} from "./python-provider.shared.ts";
import {
  PYTHON_BUILTINS,
  PYTHON_KEYWORDS,
  PYTHON_STDLIB_MODULE_BY_NAME,
  PYTHON_STDLIB_MODULE_NAMES,
  type PyMember,
  type PyModule,
} from "./python-stdlib.ts";

function itemKind(monaco: Monaco, kind: PyMember["kind"]): languages.CompletionItemKind {
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

function memberCompletion({
  monaco,
  module,
  member,
  range,
}: {
  monaco: Monaco;
  module: PyModule | null;
  member: PyMember;
  range: IRange;
}): languages.CompletionItem {
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

type SuggestContext = {
  monaco: Monaco;
  contractRef: ContractRef;
  model: editor.ITextModel;
  lineBefore: string;
  range: IRange;
};

type Suggestions = { suggestions: languages.CompletionItem[] };

/** `from X import Y` -> the members of X; undefined when X is not a known module. */
function importMemberSuggestions({
  monaco,
  lineBefore,
  range,
}: SuggestContext): Suggestions | undefined {
  const moduleName = IMPORT_MEMBER_PREFIX.exec(lineBefore)?.[1];
  const mod = moduleName ? PYTHON_STDLIB_MODULE_BY_NAME.get(moduleName) : void 0;
  if (!mod) return undefined;
  return {
    suggestions: mod.members.map((m) =>
      memberCompletion({ monaco, module: mod, member: m, range }),
    ),
  };
}

/** `import X` / `from X` -> module names. */
function importModuleSuggestions({ monaco, range }: SuggestContext): Suggestions {
  return {
    suggestions: PYTHON_STDLIB_MODULE_NAMES.map((name) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Module,
      detail: PYTHON_STDLIB_MODULE_BY_NAME.get(name)?.doc ?? "",
      insertText: name,
      range,
    })),
  };
}

/** `secrets.` -> secret names as str-typed constants; `<module>.` -> module members. */
function attributeSuggestions(
  { monaco, contractRef, model, range }: SuggestContext,
  owner: string | undefined,
): Suggestions {
  if (!owner) return { suggestions: [] };
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
        range,
        sortText: `0_${name}`,
      })),
    };
  }
  const mod = scanImports(model.getValue()).get(owner);
  if (!mod) return { suggestions: [] };
  return {
    suggestions: mod.members.map((m) =>
      memberCompletion({ monaco, module: mod, member: m, range }),
    ),
  };
}

function builtinCompletion({
  monaco,
  builtin,
  range,
}: {
  monaco: Monaco;
  builtin: (typeof PYTHON_BUILTINS)[number];
  range: IRange;
}): languages.CompletionItem {
  const isCallable = builtin.kind === "function";
  return {
    label: builtin.name,
    kind: itemKind(monaco, builtin.kind),
    detail: builtin.signature ?? "",
    documentation: { value: builtin.doc ?? "" },
    insertText: isCallable ? `${builtin.name}($0)` : builtin.name,
    ...(isCallable ? { insertTextRules: INSERT_AS_SNIPPET } : {}),
    range,
  };
}

/** `secrets` itself is always discoverable from a fresh buffer. */
function secretsHandleSuggestions({
  monaco,
  contractRef,
  range,
}: SuggestContext): languages.CompletionItem[] {
  const count = contractRef.current.secretNames.length;
  if (count === 0) return [];
  return [
    {
      label: "secrets",
      kind: monaco.languages.CompletionItemKind.Variable,
      detail: "SimpleNamespace",
      documentation: {
        value: `Project secrets namespace. Access with \`secrets.NAME\`.\n\n${count} secret${count === 1 ? "" : "s"} available.`,
      },
      insertText: "secrets",
      range,
      sortText: "0_secrets",
    },
  ];
}

/** Output keys when the user is mid-dict-literal or returning a dict. */
function outputKeySuggestions({
  monaco,
  contractRef,
  lineBefore,
  range,
}: SuggestContext): languages.CompletionItem[] {
  const wantsKey =
    /\breturn\s*\{[^}]*$/.test(lineBefore) || /\{[^}]*$/.test(lineBefore.trimStart());
  if (!wantsKey) return [];
  return contractRef.current.outputs.map((field) => {
    const defaultLit = defaultValueLiteralFor(field.type);
    return {
      label: `"${field.identifier}"`,
      kind: monaco.languages.CompletionItemKind.Field,
      detail: `${field.type}  →  ${defaultLit}`,
      documentation: {
        value: `Declared node output **${field.identifier}**: \`${field.type}\`. Inserted with a \`${defaultLit}\` default placeholder so the value already matches the declared type.`,
      },
      insertText: `"${field.identifier}": \${0:${defaultLit}}`,
      insertTextRules: INSERT_AS_SNIPPET,
      range,
      sortText: `0_output_${field.identifier}`,
    };
  });
}

/** Builtins, keywords, imported modules, node inputs and the `secrets` handle. */
function defaultSuggestions(context: SuggestContext): Suggestions {
  const { monaco, contractRef, model, range } = context;
  const imports = scanImports(model.getValue());
  return {
    suggestions: [
      ...PYTHON_BUILTINS.map((builtin) => builtinCompletion({ monaco, builtin, range })),
      ...PYTHON_KEYWORDS.map((kw) => ({
        label: kw,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: kw,
        range,
      })),
      ...Array.from(imports.keys()).map((name) => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Module,
        detail: imports.get(name)?.doc ?? "",
        insertText: name,
        range,
      })),
      // Node inputs are bound as locals from the `input` arg dict; sorted first.
      ...contractRef.current.inputs.map((field) => ({
        label: field.identifier,
        kind: monaco.languages.CompletionItemKind.Variable,
        detail: field.type,
        documentation: {
          value: `**${field.identifier}**: \`${field.type}\`\n\nNode input. Wired in the properties panel.`,
        },
        insertText: field.identifier,
        range,
        sortText: `0_input_${field.identifier}`,
      })),
      ...secretsHandleSuggestions(context),
      ...outputKeySuggestions(context),
    ],
  };
}

function suggestionsAt(context: SuggestContext): Suggestions {
  if (IMPORT_MEMBER_PREFIX.test(context.lineBefore)) {
    const members = importMemberSuggestions(context);
    if (members) return members;
  }
  if (IMPORT_MODULE_PREFIX.test(context.lineBefore)) return importModuleSuggestions(context);
  const attrMatch = ATTR_ACCESS.exec(context.lineBefore);
  if (attrMatch) return attributeSuggestions(context, attrMatch[1]);
  return defaultSuggestions(context);
}

export function registerCompletion(monaco: Monaco, contractRef: ContractRef): IDisposable {
  return monaco.languages.registerCompletionItemProvider("python", {
    // Only trigger on `.`: triggering on space pops the suggest widget on every
    // whitespace and can swallow the keystroke. Ctrl+Space / Cmd+I still work.
    triggerCharacters: ["."],
    provideCompletionItems: (model: editor.ITextModel, position: Position) => {
      const lineBefore = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const word = model.getWordUntilPosition(position);
      const range: IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return suggestionsAt({ monaco, contractRef, model, lineBefore, range });
    },
  });
}
