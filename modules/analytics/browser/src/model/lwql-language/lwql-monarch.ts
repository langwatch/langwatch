import type { LangWatchQLSchema } from "@langwatch/analytics-contract";
import type { languages } from "monaco-editor";

export const LWQL_LANGUAGE_ID = "lwql";

export const LWQL_KEYWORDS = [
  "select",
  "distinct",
  "from",
  "where",
  "group",
  "by",
  "having",
  "order",
  "limit",
  "offset",
  "as",
  "and",
  "or",
  "not",
  "in",
  "is",
  "null",
  "like",
  "ilike",
  "between",
  "case",
  "when",
  "then",
  "else",
  "end",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "outer",
  "cross",
  "on",
  "using",
  "union",
  "all",
  "with",
  "asc",
  "desc",
  "true",
  "false",
  "interval",
  "over",
  "partition",
  "exists",
] as const;

/** The identifiers the schema names, which colour differently from plain ones. */
export type LwqlVocabulary = Readonly<{
  functions: readonly string[];
  tables: readonly string[];
  columns: readonly string[];
}>;

export const EMPTY_LWQL_VOCABULARY: LwqlVocabulary = { functions: [], tables: [], columns: [] };

/** Reads the vocabulary off the live schema; nothing is listed here by hand. */
export function lwqlVocabularyOf(schema: LangWatchQLSchema | undefined): LwqlVocabulary {
  if (!schema) return EMPTY_LWQL_VOCABULARY;
  return {
    functions: [...schema.functions, ...schema.appFunctions.map((fn) => fn.name)],
    tables: schema.views.map((view) => view.name),
    columns: [...new Set(schema.views.flatMap((view) => view.columns.map((c) => c.name)))],
  };
}

export const LWQL_LANGUAGE_CONFIGURATION: languages.LanguageConfiguration = {
  comments: { lineComment: "--", blockComment: ["/*", "*/"] },
  brackets: [
    ["(", ")"],
    ["{", "}"],
  ],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: "{", close: "}" },
    { open: "'", close: "'", notIn: ["string", "comment"] },
    { open: '"', close: '"', notIn: ["string", "comment"] },
  ],
  surroundingPairs: [
    { open: "(", close: ")" },
    { open: "'", close: "'" },
    { open: '"', close: '"' },
  ],
};

/** The Monarch grammar. Case-insensitive, so `SELECT` and `select` tokenize alike. */
export function lwqlMonarch(vocabulary: LwqlVocabulary): languages.IMonarchLanguage {
  return {
    defaultToken: "",
    ignoreCase: true,
    keywords: [...LWQL_KEYWORDS],
    functions: [...vocabulary.functions],
    tables: [...vocabulary.tables],
    columns: [...vocabulary.columns],
    tokenizer: {
      root: [
        [/--.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/\{[A-Za-z_]\w*:[A-Za-z0-9_]+\}/, "variable.parameter"],
        [/'/, "string", "@string"],
        [/`[^`]*`|"[^"]*"/, "identifier.quoted"],
        [/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
        [/analytics(?=\.)/, "namespace"],
        [
          /[A-Za-z_]\w*(?=\s*\()/,
          {
            cases: { "@functions": "predefined", "@keywords": "keyword", "@default": "identifier" },
          },
        ],
        [
          /[A-Za-z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@tables": "type.identifier",
              "@columns": "attribute.name",
              "@default": "identifier",
            },
          },
        ],
        [/[()]/, "delimiter.parenthesis"],
        [/[<>=!]=?|[+\-*/%]/, "operator"],
        [/[,;.]/, "delimiter"],
        [/\s+/, "white"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      string: [
        [/[^'\\]+/, "string"],
        [/''|\\./, "string.escape"],
        [/'/, "string", "@pop"],
      ],
    },
  };
}
