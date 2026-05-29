import type { Monaco } from "@monaco-editor/react";

/**
 * Client-side Monaco support for editing trigger notification templates: a
 * lightweight Liquid language (tokens for `{{ }}` / `{% %}`), autocomplete for
 * the known template variables, and validation that flags references to a
 * variable root the context does not provide. The variable contract itself
 * comes from the server (`getTemplates.variables`) so editor and renderer agree.
 */

export type MonacoTextModel = Parameters<
  Monaco["editor"]["setModelMarkers"]
>[0];

export const LIQUID_LANGUAGE_ID = "liquid";
const MARKER_OWNER = "liquid-variables";

const KEYWORDS = new Set([
  "true",
  "false",
  "nil",
  "null",
  "empty",
  "blank",
  "and",
  "or",
  "not",
  "contains",
  "if",
  "unless",
  "else",
  "elsif",
  "endif",
  "endunless",
  "for",
  "endfor",
  "in",
  "assign",
  "capture",
  "endcapture",
  "forloop",
]);

let knownVariables: string[] = [];
let languageRegistered = false;
let providersRegistered = false;

function rootOf(path: string): string {
  return path.split(/[.[]/)[0] ?? path;
}

/**
 * Registers the Liquid language and its completion/hover providers (idempotent)
 * and refreshes the variable list the providers offer. Call from Monaco's
 * `beforeMount` so the language exists before the model is created.
 */
export function registerLiquidLanguage(
  monaco: Monaco,
  variables: string[],
): void {
  knownVariables = variables;

  if (!languageRegistered) {
    monaco.languages.register({ id: LIQUID_LANGUAGE_ID });
    monaco.languages.setMonarchTokensProvider(LIQUID_LANGUAGE_ID, {
      tokenizer: {
        root: [
          [/\{\{/, { token: "delimiter.liquid", next: "@output" }],
          [/\{%/, { token: "delimiter.liquid", next: "@tag" }],
          [/[^{]+/, ""],
          [/\{/, ""],
        ],
        output: [
          [/\}\}/, { token: "delimiter.liquid", next: "@pop" }],
          [/\|/, "operator.liquid"],
          [/[a-zA-Z_][\w.]*/, "variable.liquid"],
          [/[^}]/, ""],
        ],
        tag: [
          [/%\}/, { token: "delimiter.liquid", next: "@pop" }],
          [/\b(if|elsif|else|endif|unless|endunless|for|endfor|in|assign|capture|endcapture)\b/, "keyword.liquid"],
          [/[a-zA-Z_][\w.]*/, "variable.liquid"],
          [/[^%]/, ""],
        ],
      },
    });
    languageRegistered = true;
  }

  if (!providersRegistered) {
    monaco.languages.registerCompletionItemProvider(LIQUID_LANGUAGE_ID, {
      triggerCharacters: [".", " ", "{", "%"],
      provideCompletionItems: (model, position) => {
        const lineUntil = model
          .getLineContent(position.lineNumber)
          .slice(0, position.column - 1);
        const run = /[\w.[\]]*$/.exec(lineUntil)?.[0] ?? "";
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - run.length,
          endColumn: position.column,
        };

        const variableItems = knownVariables.map((variable) => ({
          label: variable,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: variable,
          range,
          detail: "Template variable",
        }));

        const snippets = [
          {
            label: "for m in matches",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "{% for m in matches %}\n\t$0\n{% endfor %}",
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: "Iterate matched traces",
          },
          {
            label: "if",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "{% if $1 %}\n\t$0\n{% endif %}",
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: "Conditional block",
          },
        ];

        return { suggestions: [...variableItems, ...snippets] };
      },
    });

    monaco.languages.registerHoverProvider(LIQUID_LANGUAGE_ID, {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const match = knownVariables.find(
          (variable) => rootOf(variable) === word.word,
        );
        if (!match) return null;
        return {
          contents: [{ value: `Template variable root \`${word.word}\`` }],
        };
      },
    });

    providersRegistered = true;
  }
}

function collectLocals(text: string, known: Set<string>): void {
  const patterns = [
    /\{%-?\s*for\s+(\w+)\s+in\b/g,
    /\{%-?\s*assign\s+(\w+)\s*=/g,
    /\{%-?\s*capture\s+(\w+)\s*-?%\}/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) known.add(match[1]);
    }
  }
}

export interface UnknownVariable {
  /** The unrecognised root identifier, e.g. "tigger" in `{{ tigger.name }}`. */
  root: string;
  /** The full leading variable token, e.g. "tigger.name". */
  token: string;
  /** Character offset of the token within the source. */
  index: number;
  /** The roots that would have been accepted, for the diagnostic message. */
  knownRoots: string[];
}

/**
 * Finds `{{ ... }}` output expressions whose leading variable has a root the
 * context does not provide — the common typo case (`{{ tigger.name }}`).
 * For-loop / assign / capture locals declared in the document are treated as
 * known. Filters (after `|`), literals, and tag syntax are ignored; tag syntax
 * is validated server-side. Pure (no Monaco) so it can be unit-tested.
 */
export function detectUnknownVariables(
  text: string,
  variables: string[],
): UnknownVariable[] {
  const known = new Set(variables.map(rootOf));
  known.add("forloop");
  collectLocals(text, known);
  const knownRoots = [...known].sort();

  const found: UnknownVariable[] = [];
  const outputRe = /\{\{-?([\s\S]*?)-?\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = outputRe.exec(text)) !== null) {
    const expr = match[1] ?? "";
    const firstPart = expr.split("|")[0]?.trim() ?? "";
    const idMatch = /^[a-zA-Z_][\w]*(?:\.[\w]+|\[\d+\])*/.exec(firstPart);
    if (!idMatch) continue;

    const token = idMatch[0];
    const root = rootOf(token);
    if (KEYWORDS.has(token) || KEYWORDS.has(root) || known.has(root)) {
      continue;
    }

    const tokenOffset =
      match[0].indexOf(expr) + expr.indexOf(firstPart) + firstPart.indexOf(token);
    found.push({ root, token, index: match.index + tokenOffset, knownRoots });
  }

  return found;
}

/**
 * Sets validation markers for unknown-variable references in a Monaco model.
 */
export function validateLiquidModel(
  monaco: Monaco,
  model: MonacoTextModel,
  variables: string[],
): void {
  const markers: Parameters<Monaco["editor"]["setModelMarkers"]>[2] =
    detectUnknownVariables(model.getValue(), variables).map((unknown) => {
      const start = model.getPositionAt(unknown.index);
      const end = model.getPositionAt(unknown.index + unknown.token.length);
      return {
        severity: monaco.MarkerSeverity.Warning,
        message: `Unknown variable "${unknown.root}". Known roots: ${unknown.knownRoots.join(", ")}`,
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      };
    });

  monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
}

export function clearLiquidMarkers(
  monaco: Monaco,
  model: MonacoTextModel,
): void {
  monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
}
