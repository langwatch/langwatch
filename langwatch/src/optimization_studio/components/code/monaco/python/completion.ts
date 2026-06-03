import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, IRange, languages } from "monaco-editor";
import {
  PYTHON_BUILTINS,
  PYTHON_KEYWORDS,
  PYTHON_STDLIB_MODULE_BY_NAME,
  PYTHON_STDLIB_MODULE_NAMES,
  type PyMember,
  type PyModule,
} from "../pythonStdlib";
import {
  ATTR_ACCESS,
  type ContractRef,
  defaultValueLiteralFor,
  IMPORT_MEMBER_PREFIX,
  IMPORT_MODULE_PREFIX,
  INSERT_AS_SNIPPET,
  scanImports,
} from "./shared";

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

export function registerCompletion(
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
