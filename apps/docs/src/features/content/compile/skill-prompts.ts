import { createHash } from "node:crypto";

import { withBasePath } from "../../../lib/site-path.ts";
import { PROMPT_ATTRIBUTE, PROMPT_FILE_ATTRIBUTE } from "../../code/ui/copy-source.ts";
import { PROMPT_BODY_ATTRIBUTE, PROMPT_FRAGMENT_ATTRIBUTE } from "../ui/prompt-attributes.ts";

const PROMPT_PATTERN = new RegExp(` ${PROMPT_ATTRIBUTE}="([^"]*)"`, "g");
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Reverses the escaping React applies to an attribute value. */
function unescapeAttribute({ value }: { value: string }) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X"))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** Content-addressed, so a prompt shared by several pages is written once. */
export function promptFileName({ prompt }: { prompt: string }) {
  return `skill-prompts/${createHash("sha256").update(prompt).digest("hex").slice(0, 16)}.md`;
}

/**
 * Moves every skill prompt out of the built pages into a file its copy button fetches, so each
 * page stops carrying the prompt a second time beside its rendered preview. Rewrites `pages` in
 * place and returns the prompt files (output-relative path to contents) to write.
 */
export function extractSkillPrompts({ pages }: { pages: Map<string, string> }) {
  const files = new Map<string, string>();
  for (const [target, html] of pages) {
    if (!html.includes(PROMPT_ATTRIBUTE)) continue;
    const moved = html.replace(PROMPT_PATTERN, (_match, escaped: string) => {
      const prompt = unescapeAttribute({ value: escaped });
      const name = promptFileName({ prompt });
      files.set(name, prompt);
      return ` ${PROMPT_FILE_ATTRIBUTE}="${name}"`;
    });
    pages.set(target, moved);
  }
  return files;
}

/* React escapes `<` and `>` in text and attributes, so every `<` in its markup opens a tag. */
const TAG_PATTERN = /<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g;
const VOID_TAGS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "source", "wbr"]);
const BODY_PATTERN = new RegExp(`<div\\b[^>]*\\s${PROMPT_BODY_ATTRIBUTE}=""[^>]*>`, "g");
const FILE_PATTERN = new RegExp(`${PROMPT_FILE_ATTRIBUTE}="([^"]*)"`, "g");
const PREVIEW_BLOCKS = 2;

/** A built prompt fragment's output-relative path: content-addressed, cached as an asset. */
export const PROMPT_FRAGMENT_FILE = /^assets\/skill-prompt-[0-9a-f]{16}\.html$/;
/** The output-relative fragment files a built page names, given its base path. */
export function namedFragments({ html, basePath }: { html: string; basePath: string }) {
  const pattern = new RegExp(`\\s${PROMPT_FRAGMENT_ATTRIBUTE}="([^"]*)"`, "g");
  return [...html.matchAll(pattern)].map((match) => match[1].slice(basePath.length + 1));
}
const PREVIEW_BYTES = 2_000;

/** The end of the element whose content starts at `from`, and its top-level children. */
function scanContent({ html, from }: { html: string; from: number }) {
  const children: { start: number; end: number }[] = [];
  let depth = 0;
  for (const tag of html.slice(from).matchAll(TAG_PATTERN)) {
    const [markup, closing, name, selfClosing] = tag;
    const at = from + tag.index;
    if (closing) {
      depth -= 1;
      if (depth < 0) return { end: at, children };
      if (depth === 0)
        children.push({ start: children.pop()?.start ?? at, end: at + markup.length });
    } else if (!selfClosing && !VOID_TAGS.has(name.toLowerCase())) {
      if (depth === 0) children.push({ start: at, end: at });
      depth += 1;
    } else if (depth === 0) children.push({ start: at, end: at + markup.length });
  }
  throw new Error("A skill prompt body is never closed");
}

/** The leading blocks the page keeps closed-over: at most two, each short enough to stay cheap. */
function preview({ html, children }: { html: string; children: { start: number; end: number }[] }) {
  const kept = [];
  for (const { start, end } of children.slice(0, PREVIEW_BLOCKS)) {
    if (end - start > PREVIEW_BYTES) break;
    kept.push(html.slice(start, end));
  }
  return kept.join("");
}

/**
 * Moves each skill prompt's body into a hashed `assets/` fragment the prompt island fetches on
 * first open; the page keeps a preview and a link to the prompt's Markdown. Run after
 * `extractSkillPrompts`. Rewrites `pages` in place and returns the fragments to write.
 */
export function extractPromptBodies({
  pages,
  basePath,
}: {
  pages: Map<string, string>;
  basePath: string;
}) {
  const files = new Map<string, string>();
  for (const [target, html] of pages) {
    if (!html.includes(PROMPT_BODY_ATTRIBUTE)) continue;
    let output = "";
    let cursor = 0;
    for (const opening of html.matchAll(BODY_PATTERN)) {
      const from = opening.index + opening[0].length;
      if (from <= cursor) continue;
      const { end, children } = scanContent({ html, from });
      const body = html.slice(from, end);
      const name = `assets/skill-prompt-${createHash("sha256").update(body).digest("hex").slice(0, 16)}.html`;
      files.set(name, body);
      const prompt = [...html.slice(0, opening.index).matchAll(FILE_PATTERN)].at(-1)?.[1];
      const link = prompt
        ? `<p><a href="${withBasePath({ basePath, path: `/${prompt}` })}">Read the full prompt</a></p>`
        : "";
      const tag = opening[0].replace(
        `${PROMPT_BODY_ATTRIBUTE}=""`,
        `${PROMPT_FRAGMENT_ATTRIBUTE}="${withBasePath({ basePath, path: `/${name}` })}"`,
      );
      output += html.slice(cursor, opening.index) + tag + preview({ html, children }) + link;
      cursor = end;
    }
    pages.set(target, output + html.slice(cursor));
  }
  return files;
}
