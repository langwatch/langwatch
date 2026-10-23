/** A gap on one page; `weight` orders the worst offenders (tokens, or how many blocks). */
export type AgentIssue = { page: string; code: string; detail: string; weight?: number };
type PageIssue = Omit<AgentIssue, "page">;

type CodeBlock = { lang: string; lines: string[] };
type Block = { kind: "code"; code: CodeBlock } | { kind: ProseKind; lines: string[] };
type ProseKind = "heading" | "quote" | "list" | "table" | "component" | "image" | "paragraph";

/** The named approximation: about four characters per token for English prose and code. */
export const TOKENISER = "characters / 4";
export function approximateTokens({ text }: { text: string }) {
  return Math.ceil(text.length / 4);
}

const SHELL = new Set(["bash", "sh", "shell", "zsh", "console", "terminal", "fish", "powershell"]);
const LANGUAGE_OF: Record<string, Language> = {
  python: "python",
  py: "python",
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  javascript: "typescript",
  js: "typescript",
  jsx: "typescript",
  mjs: "typescript",
  go: "go",
  java: "java",
  kotlin: "java",
};
type Language = "python" | "typescript" | "go" | "java";

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/** The export as blocks: fenced code kept whole, prose split at blank lines and fences. */
export function markdownBlocks({ markdown }: { markdown: string }): Block[] {
  const state: BlockState = { blocks: [], prose: [], fence: null };
  for (const line of markdown.split("\n")) readLine({ state, line });
  flushProse({ state });
  if (state.fence) state.blocks.push({ kind: "code", code: state.fence.code });
  return state.blocks;
}

type BlockState = {
  blocks: Block[];
  prose: string[];
  fence: { marker: string; code: CodeBlock } | null;
};

function flushProse({ state }: { state: BlockState }) {
  if (state.prose.length > 0)
    state.blocks.push({ kind: proseKind({ line: state.prose[0] }), lines: state.prose });
  state.prose = [];
}

function closesFence({ match, marker }: { match: RegExpExecArray | null; marker: string }) {
  if (!match || match[1][0] !== marker[0]) return false;
  return match[1].length >= marker.length && match[2].trim() === "";
}

function readLine({ state, line }: { state: BlockState; line: string }) {
  const match = FENCE.exec(line);
  if (state.fence) {
    if (closesFence({ match, marker: state.fence.marker })) {
      state.blocks.push({ kind: "code", code: state.fence.code });
      state.fence = null;
    } else state.fence.code.lines.push(line);
    return;
  }
  if (match) {
    flushProse({ state });
    const lang = match[2].trim().split(/\s+/)[0].toLowerCase();
    state.fence = { marker: match[1], code: { lang, lines: [] } };
  } else if (line.trim() === "") flushProse({ state });
  else if (/^#{1,6}\s/.test(line)) {
    flushProse({ state });
    state.blocks.push({ kind: "heading", lines: [line] });
  } else state.prose.push(line);
}

function proseKind({ line }: { line: string }): ProseKind {
  if (/^#{1,6}\s/.test(line)) return "heading";
  if (/^\s*>/.test(line)) return "quote";
  if (/^\s*([-*+]|\d+\.)\s/.test(line)) return "list";
  if (/^\s*\|/.test(line)) return "table";
  if (/^\s*<\/?[A-Za-z]/.test(line)) return "component";
  if (/^\s*!\[/.test(line)) return "image";
  return "paragraph";
}

const PREAMBLE =
  /^(in this (guide|tutorial|page|section|article|document|walkthrough)|this (guide|tutorial|page|section|article|document|walkthrough) (will|shows|explains|covers|walks|describes|demonstrates)|we will|we'll|we are going|let's|let us|here,? (we|you'll|you will)|welcome\b|in the following|below,? (we|you)|you will learn|you'll learn)\b/i;

/** The description after the title, and the first paragraph before the first section heading. */
export function openingOf({ blocks }: { blocks: Block[] }) {
  const title = blocks.findIndex(
    (block) => block.kind === "heading" && block.lines[0].startsWith("# "),
  );
  const rest = blocks.slice(title + 1);
  const description = rest[0]?.kind === "paragraph" ? rest[0].lines.join(" ") : null;
  let firstParagraph: string | null = null;
  for (const block of rest.slice(description === null ? 0 : 1)) {
    if (block.kind === "heading") break;
    if (block.kind === "paragraph") {
      firstParagraph = block.lines.join(" ").trim();
      break;
    }
  }
  return { description, firstParagraph };
}

function openingIssues({ blocks }: { blocks: Block[] }): PageIssue[] {
  const { description, firstParagraph } = openingOf({ blocks });
  const issues: PageIssue[] = [];
  if (!description)
    issues.push({ code: "export-missing-description", detail: "no description under the title" });
  if (!description && !firstParagraph)
    issues.push({ code: "first-paragraph-missing", detail: "no prose before the first section" });
  const announcing = [description, firstParagraph].find(
    (text) => text && PREAMBLE.test(text.replace(/^[*_\s]+/, "")),
  );
  if (announcing)
    issues.push({ code: "first-paragraph-preamble", detail: `"${announcing.slice(0, 80)}"` });
  return issues;
}

const PLACEHOLDER =
  /^(\.\.\.|…|\.\.\.\s*\w*|(#|\/\/|--)(\s.*)?|\/\*.*|\*.*|<[\w .-]+>|\{\{[^}]*\}\}|\[[^\]]*\]|your[-_ ]\S*|todo\b.*)$/i;
const SDK_CALL: Record<Language, RegExp> = {
  python: /\blangwatch\.\w/,
  typescript:
    /\b(setupObservability|getLangWatchTracer|getLangWatchLogger|new LangWatch\b|langwatch\.\w)/,
  go: /\blangwatch\.\w/,
  java: /\bLangWatch\w*\b/,
};
const SDK_IMPORT: Record<Language, RegExp> = {
  python: /^\s*(import langwatch|from langwatch\b)/m,
  typescript: /(from\s+["']langwatch|require\(\s*["']langwatch|import\s+["']langwatch)/,
  go: /github\.com\/langwatch\/langwatch/,
  java: /^\s*import\s+[\w.]*langwatch/im,
};
const ANY_IMPORT: Record<Language, RegExp> = {
  python: /^\s*(import|from)\s+\w/m,
  typescript: /^\s*import\s|require\(/m,
  go: /^\s*import\s/m,
  java: /^\s*import\s/m,
};
/* Strings and comments may say "langwatch.ai" or "langwatch.user.id" without calling the SDK. */
const NOT_CODE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`|(?:#|\/\/).*$/gm;
/** Below this many lines a block reads as a call fragment, not a sample to paste. */
const MIN_SAMPLE_LINES = 4;

const filled = ({ code }: { code: CodeBlock }) => code.lines.filter((line) => line.trim() !== "");
const placeholderOnly = ({ code }: { code: CodeBlock }) => {
  const lines = filled({ code });
  return lines.length > 0 && lines.every((line) => PLACEHOLDER.test(line.trim()));
};

function counted({ code, count, what }: { code: string; count: number; what: string }) {
  return count === 0 ? [] : [{ code, detail: `${count} ${what}`, weight: count }];
}

function codeIssues({ codes }: { codes: CodeBlock[] }): PageIssue[] {
  const untagged = codes.filter((code) => code.lang === "").length;
  const prompts = codes.filter(
    (code) => SHELL.has(code.lang) && code.lines.some((line) => /^\s*\$ \S/.test(line)),
  ).length;
  const placeholders = codes.filter(
    (code) => (SHELL.has(code.lang) || code.lang in LANGUAGE_OF) && placeholderOnly({ code }),
  ).length;
  const unimported = codes.filter((code) => {
    const language = LANGUAGE_OF[code.lang];
    if (!language || filled({ code }).length < MIN_SAMPLE_LINES) return false;
    const text = code.lines.join("\n");
    const calls = SDK_CALL[language].test(text.replace(NOT_CODE, '""'));
    return calls && !SDK_IMPORT[language].test(text);
  }).length;
  return [
    ...counted({ code: "code-untagged", count: untagged, what: "blocks without a language" }),
    ...counted({ code: "code-shell-prompt", count: prompts, what: 'shell blocks with "$ "' }),
    ...counted({ code: "code-placeholder-only", count: placeholders, what: "placeholder blocks" }),
    ...counted({ code: "code-missing-import", count: unimported, what: "SDK samples, no import" }),
  ];
}

function fidelityIssues({ blocks }: { blocks: Block[] }): PageIssue[] {
  const leaked = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind === "code") continue;
    for (const line of block.lines) {
      const name =
        /^\s*<\/?([A-Z][A-Za-z0-9.]*)\b/.exec(line)?.[1] ??
        (/^(import|export)\s.+/.test(line) ? "import/export" : null) ??
        (line.includes("{/*") ? "MDX comment" : null);
      if (name) leaked.set(name, (leaked.get(name) ?? 0) + 1);
    }
  }
  if (leaked.size === 0) return [];
  const total = [...leaked.values()].reduce((sum, count) => sum + count, 0);
  const names = [...leaked.keys()].toSorted().join(", ");
  return [{ code: "export-raw-component", detail: `${total} raw tags: ${names}`, weight: total }];
}

const INSTALL: Record<Language, RegExp> = {
  python: /\b(pip3? install|uv (add|pip install)|poetry add|pipenv install|conda install)\b/,
  typescript: /\b(npm (i|install|add)|pnpm (add|i|install)|yarn add|bun add)\b/,
  go: /\bgo (get|install)\b/,
  java: /<dependency>|implementation\s*\(?\s*["']|\bmvn\s|\bgradle\s/,
};
const VERIFY =
  /\b(verify|confirm|check that|you should (now )?see|should (now )?appear|(see|view|find) (it|them|the traces?|your traces?)|open (the|your) (langwatch )?(dashboard|project)|in the langwatch (dashboard|ui|app)|traces? (page|tab|view))\b/i;

/** The four things an agent needs to wire LangWatch in one pass: install, key, sample, proof. */
function integrationIssues({ blocks }: { blocks: Block[] }): PageIssue[] {
  const codes = blocks.flatMap((block) => (block.kind === "code" ? [block.code] : []));
  const allCode = codes.map((code) => code.lines.join("\n")).join("\n");
  const prose = blocks.flatMap((block) => (block.kind === "code" ? [] : block.lines)).join("\n");
  const languages = [...new Set(codes.flatMap((code) => LANGUAGE_OF[code.lang] ?? []))].toSorted();
  const issues: PageIssue[] = [];
  const uninstalled = languages.filter((language) => !INSTALL[language].test(allCode));
  if (uninstalled.length > 0)
    issues.push({
      code: "integration-no-install",
      detail: `no install for ${uninstalled.join(", ")}`,
    });
  if (!/\bLANGWATCH_API_KEY\b/.test(`${prose}\n${allCode}`))
    issues.push({ code: "integration-no-env-var", detail: "LANGWATCH_API_KEY is never named" });
  const complete = codes.some((code) => {
    const language = LANGUAGE_OF[code.lang];
    return (
      language &&
      filled({ code }).length >= 5 &&
      ANY_IMPORT[language].test(code.lines.join("\n")) &&
      !placeholderOnly({ code })
    );
  });
  if (!complete)
    issues.push({
      code: "integration-no-complete-sample",
      detail: "no tagged sample with imports",
    });
  if (!VERIFY.test(prose))
    issues.push({ code: "integration-no-verify", detail: "no step to see that it worked" });
  return issues;
}

/** Every per-page check on one Markdown export; integration checks only where they apply. */
export function checkPageMarkdown({
  markdown,
  integration,
  pageTokens,
}: {
  markdown: string;
  integration: boolean;
  pageTokens: number;
}): { tokens: number; issues: PageIssue[] } {
  const blocks = markdownBlocks({ markdown });
  const tokens = approximateTokens({ text: markdown });
  const codes = blocks.flatMap((block) => (block.kind === "code" ? [block.code] : []));
  const issues: PageIssue[] = [
    ...(tokens > pageTokens
      ? [
          {
            code: "tokens-over-budget",
            detail: `${tokens} tokens, budget ${pageTokens}`,
            weight: tokens,
          },
        ]
      : []),
    ...openingIssues({ blocks }),
    ...codeIssues({ codes }),
    ...fidelityIssues({ blocks }),
    ...(integration ? integrationIssues({ blocks }) : []),
  ];
  return { tokens, issues };
}
