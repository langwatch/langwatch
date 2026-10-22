import { createHash } from "node:crypto";

import { PROMPT_ATTRIBUTE, PROMPT_FILE_ATTRIBUTE } from "../../code/ui/copy-source.ts";

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
