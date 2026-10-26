import { docsUrl } from "../../../lib/site-path.ts";
import { promptFileName } from "../../content/compile.ts";
import { heading, markedLines, type Context, type MarkedLine } from "./mdx-text.ts";

/** A skill as its title, its two commands and a link to its prompt's own Markdown file. */
export function skillMarkdown({
  title,
  install,
  command,
  prompt,
  context,
}: {
  title: string;
  install: string;
  command: string;
  prompt: string;
  context: Context;
}) {
  const lines = [
    install ? `- Install via CLI: \`${install}\`` : "",
    command ? `- Skill command: \`${command}\`` : "",
    prompt ? `- Full prompt: ${docsUrl({ path: `/${promptFileName({ prompt })}` })}` : "",
  ];
  return [heading({ context, title }), lines.filter(Boolean).join("\n")].join("\n\n");
}

/** Text with every tag removed, repeated so `<<b>b>` cannot leave one behind. */
function withoutTags(markup: string): string {
  let text = markup;
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text;
}

const SKILL_CARD = /^(\s*)<div className="lw-accordion">\s*$/;

/** Generated `lw-accordion` skill markup, read as the remark adapter reads it. */
function skillFromMarkup({ lines, context }: { lines: MarkedLine[]; context: Context }) {
  const markup = lines
    .filter((line) => !line.code)
    .map((line) => line.text)
    .join("\n");
  const title = /lw-accordion-title"[^>]*>([^<]*)</.exec(markup)?.[1] ?? "Skill";
  const commands = [...markup.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((match) =>
    withoutTags(match[1] ?? "").trim(),
  );
  const code = lines.filter((line) => line.code);
  const close = code.findIndex((line) => line.closes);
  const prompt = code
    .slice(1, close === -1 ? void 0 : close)
    .map((line) => line.text)
    .join("\n");
  return skillMarkdown({
    title,
    install: commands[0] ?? "",
    command: commands[1] ?? "",
    prompt,
    context,
  });
}

/** A skill card opening on this line, or null. */
function cardOpening({ line }: { line: MarkedLine }) {
  const opening = line.code ? null : SKILL_CARD.exec(line.text);
  return opening ? { indent: opening[1] ?? "", lines: [] as MarkedLine[] } : null;
}

/** The section level after a line: a prose heading's, else the one before. */
function proseLevel({ line, level }: { line: MarkedLine; level: number }) {
  if (line.code) return level;
  return /^(#{1,6})\s/.exec(line.text)?.[1]?.length ?? level;
}

/** Swaps each generated skill card for its commands and prompt link; nothing else changes. */
export function skillCards({ source }: { source: string }) {
  if (!source.includes("lw-accordion")) return source;
  const output: string[] = [];
  let card: { indent: string; lines: MarkedLine[] } | null = null;
  let level = 1;
  for (const line of markedLines({ source })) {
    card ??= cardOpening({ line });
    if (!card) {
      level = proseLevel({ line, level });
      output.push(line.text);
      continue;
    }
    card.lines.push(line);
    if (line.code || line.text !== `${card.indent}</div>`) continue;
    output.push(skillFromMarkup({ lines: card.lines, context: { level } }));
    card = null;
  }
  if (card) output.push(...card.lines.map((line) => line.text));
  return output.join("\n");
}

/* One converter per component the MDX renderer registers, plus the HTML media authors use.
   A converter returns plain Markdown; content nested in a component is converted first. */
