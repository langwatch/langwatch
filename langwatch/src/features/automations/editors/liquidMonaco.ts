import type { Monaco } from "@monaco-editor/react";
import { substituteLiquidForJsonValidation } from "./liquidJsonSubstitution";

/**
 * Rich variable info the autocomplete uses: path + TypeScript-ish type +
 * optional description. Lives next to the editor that consumes it; the
 * paired `templates/scaffold.ts` re-exports the canonical list as
 * `TEMPLATE_VARIABLES` and a drift-prevention test pins it to the server's
 * `TEMPLATE_VARIABLES`.
 */
export interface VariableInfo {
  path: string;
  type: string;
  description?: string;
}

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
/** Hybrid JSON + Liquid: full JSON tokenization (strings, brackets, numbers,
 *  keywords) plus Liquid output / tag spans. Used by the Slack Block Kit
 *  editor so `{{ var }}` / `{% if %}` don't read as JSON syntax errors. No
 *  semantic JSON validation — the server-side renderer validates structure
 *  after Liquid substitutes. */
export const LIQUID_JSON_LANGUAGE_ID = "liquid-json";
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

let knownVariables: VariableInfo[] = [];
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
  variables: VariableInfo[],
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

    monaco.languages.register({ id: LIQUID_JSON_LANGUAGE_ID });
    monaco.languages.setLanguageConfiguration(LIQUID_JSON_LANGUAGE_ID, {
      brackets: [
        ["{", "}"],
        ["[", "]"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
        { open: "{{", close: " }}" },
        { open: "{%", close: " %}" },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
      ],
    });
    monaco.languages.setMonarchTokensProvider(LIQUID_JSON_LANGUAGE_ID, {
      defaultToken: "",
      tokenPostfix: ".liquid-json",
      keywords: ["true", "false", "null"],
      tokenizer: {
        root: [
          [/\{\{/, { token: "delimiter.liquid", next: "@liquidOutput" }],
          [/\{%/, { token: "delimiter.liquid", next: "@liquidTag" }],
          [/[{}\[\]]/, "@brackets"],
          [/[,:]/, "delimiter"],
          [/"/, { token: "string.quote", next: "@string" }],
          [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?/, "number"],
          [
            /[a-zA-Z_]\w*/,
            { cases: { "@keywords": "keyword", "@default": "" } },
          ],
          [/\s+/, "white"],
        ],
        string: [
          [/\{\{/, { token: "delimiter.liquid", next: "@liquidOutput" }],
          [/\{%/, { token: "delimiter.liquid", next: "@liquidTag" }],
          [/[^"\\{]+/, "string"],
          [/\\(?:[\\"/bfnrt]|u[0-9A-Fa-f]{4})/, "string.escape"],
          [/\\/, "string"],
          [/\{/, "string"],
          [/"/, { token: "string.quote", next: "@pop" }],
        ],
        liquidOutput: [
          [/\}\}/, { token: "delimiter.liquid", next: "@pop" }],
          [/\|/, "operator.liquid"],
          [/[a-zA-Z_][\w.]*/, "variable.liquid"],
          [/[^}]/, ""],
        ],
        liquidTag: [
          [/%\}/, { token: "delimiter.liquid", next: "@pop" }],
          [
            /\b(if|elsif|else|endif|unless|endunless|for|endfor|in|assign|capture|endcapture)\b/,
            "keyword.liquid",
          ],
          [/[a-zA-Z_][\w.]*/, "variable.liquid"],
          [/[^%]/, ""],
        ],
      },
    });
    languageRegistered = true;
  }

  if (!providersRegistered) {
    const completionProvider: Parameters<
      Monaco["languages"]["registerCompletionItemProvider"]
    >[1] = {
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
          label: variable.path,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: variable.path,
          range,
          detail: variable.type,
          documentation: variable.description
            ? { value: variable.description }
            : undefined,
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
    };

    const hoverProvider: Parameters<
      Monaco["languages"]["registerHoverProvider"]
    >[1] = {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const match = knownVariables.find(
          (variable) => rootOf(variable.path) === word.word,
        );
        if (!match) return null;
        return {
          contents: [
            { value: `**${match.path}** — \`${match.type}\`` },
            ...(match.description ? [{ value: match.description }] : []),
          ],
        };
      },
    };

    for (const id of [LIQUID_LANGUAGE_ID, LIQUID_JSON_LANGUAGE_ID]) {
      monaco.languages.registerCompletionItemProvider(id, completionProvider);
      monaco.languages.registerHoverProvider(id, hoverProvider);
    }

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
  variables: VariableInfo[],
): UnknownVariable[] {
  const known = new Set(variables.map((v) => rootOf(v.path)));
  known.add("forloop");
  // The internal `matches[]` array stays available on the context even though
  // it is not in the advertised variable list — accept it as a known root so
  // we don't warn on advanced templates that iterate it.
  known.add("matches");
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
  variables: VariableInfo[],
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

const SCHEMA_MARKER_OWNER = "liquid-json-schema";
const registeredSchemas = new Map<string, object>();

/**
 * Wires JSON Schema validation onto a `liquid-json` editor model. Liquid is
 * not valid JSON, so we maintain a hidden "shadow" model with the same
 * length-preserving content where Liquid spans are replaced by placeholders
 * (`liquidJsonSubstitution`). Monaco's built-in JSON language service
 * validates the shadow against the supplied schema; any markers it produces
 * are mirrored onto the real model — positions are identical because the
 * substitution preserves byte length and newline placement.
 *
 * Returns a `dispose` function: callers must invoke it on unmount, otherwise
 * the shadow model leaks across editor mounts.
 */
export function setupLiquidJsonSchema(params: {
  monaco: Monaco;
  realModel: MonacoTextModel;
  schema: object;
  /** Stable file URI for the shadow model. Different editors must use
   *  different URIs so their schemas don't collide. */
  shadowUri: string;
}): { dispose: () => void } {
  const { monaco, realModel, schema, shadowUri } = params;

  registeredSchemas.set(shadowUri, schema);
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: Array.from(registeredSchemas.entries()).map(([uri, s]) => ({
      uri: `inmemory://schemas/${encodeURIComponent(uri)}.schema.json`,
      fileMatch: [uri],
      schema: s,
    })),
  });
  const shadowResource = monaco.Uri.parse(shadowUri);
  // Re-mount safety: another instance with the same shadow URI may have left
  // a model behind if it was disposed mid-update.
  const existing = monaco.editor.getModel(shadowResource);
  if (existing) existing.dispose();
  const initial = substituteLiquidForJsonValidation(realModel.getValue());
  const shadowModel = monaco.editor.createModel(
    initial.substituted,
    "json",
    shadowResource,
  );

  const mirrorMarkers = () => {
    const shadowMarkers = monaco.editor.getModelMarkers({
      resource: shadowResource,
    });
    const mapped: Parameters<Monaco["editor"]["setModelMarkers"]>[2] =
      shadowMarkers.map((m) => ({
        severity: m.severity,
        message: m.message,
        startLineNumber: m.startLineNumber,
        startColumn: m.startColumn,
        endLineNumber: m.endLineNumber,
        endColumn: m.endColumn,
      }));
    monaco.editor.setModelMarkers(realModel, SCHEMA_MARKER_OWNER, mapped);
  };

  const onShadowMarkers = monaco.editor.onDidChangeMarkers((resources) => {
    if (resources.some((r) => r.toString() === shadowResource.toString())) {
      mirrorMarkers();
    }
  });

  const onRealChange = realModel.onDidChangeContent(() => {
    const next = substituteLiquidForJsonValidation(realModel.getValue());
    shadowModel.setValue(next.substituted);
  });

  // Prime the mirror with the markers the JSON service emits on the first
  // tick after model creation.
  mirrorMarkers();

  return {
    dispose: () => {
      onRealChange.dispose();
      onShadowMarkers.dispose();
      monaco.editor.setModelMarkers(realModel, SCHEMA_MARKER_OWNER, []);
      if (!shadowModel.isDisposed()) shadowModel.dispose();
    },
  };
}

