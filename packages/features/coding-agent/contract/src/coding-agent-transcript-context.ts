const MAX_INJECTED_CONTEXT_CHARS = 64_000;
const TAG_NAME_START = /[A-Za-z_]/;
const TAG_NAME_CHAR = /[\w.-]/;
const TAG_ATTRIBUTE_LEAD = /\s/;

interface OpenTag {
  name: string;
  bodyStart: number;
}

interface TagEndScan {
  from: number;
  at: number;
}

export function isInjectedContextOnly(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("<")) return false;
  if (trimmed.length > MAX_INJECTED_CONTEXT_CHARS) return false;

  return strippedOfTagBlocks(trimmed).trim().length === 0;
}

export function systemReminderText(content: string): string | null {
  const blocks = content.match(/<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/g);
  if (blocks === null || blocks.length === 0) return null;

  const text = blocks.join("\n\n").trim();
  return text.length > 0 ? text : null;
}

function strippedOfTagBlocks(text: string): string {
  const closesByName = indexCloseTagPositions(text);
  const closeCursors = new Map<string, number>();
  const tagEnds: TagEndScan = { from: 0, at: text.indexOf(">") };

  const kept: string[] = [];
  let keptFrom = 0;
  let at = text.indexOf("<");

  while (at !== -1) {
    const open = readOpenTag(text, at, tagEnds);
    const closeAt =
      open === null
        ? null
        : closeTagAtOrAfter({
            closesByName,
            closeCursors,
            name: open.name,
            from: open.bodyStart,
          });

    if (open === null || closeAt === null) {
      at = text.indexOf("<", at + 1);
      continue;
    }

    kept.push(text.slice(keptFrom, at));
    keptFrom = closeAt + open.name.length + "</>".length;
    at = text.indexOf("<", keptFrom);
  }

  kept.push(text.slice(keptFrom));
  return kept.join("");
}

function tagNameEnd(text: string, from: number): number {
  const first = text[from];
  if (first === void 0 || !TAG_NAME_START.test(first)) return from;

  let cursor = from + 1;
  while (cursor < text.length && TAG_NAME_CHAR.test(text[cursor]!)) cursor += 1;
  return cursor;
}

function indexCloseTagPositions(text: string): Map<string, number[]> {
  const byName = new Map<string, number[]>();
  let at = text.indexOf("</");

  while (at !== -1) {
    const nameStart = at + "</".length;
    const nameEnd = tagNameEnd(text, nameStart);
    if (nameEnd > nameStart && text[nameEnd] === ">") {
      const name = text.slice(nameStart, nameEnd);
      const positions = byName.get(name);
      if (positions) positions.push(at);
      else byName.set(name, [at]);
    }
    at = text.indexOf("</", at + 1);
  }

  return byName;
}

function readOpenTag(text: string, at: number, tagEnds: TagEndScan): OpenTag | null {
  const nameStart = at + 1;
  const nameEnd = tagNameEnd(text, nameStart);
  if (nameEnd === nameStart) return null;

  const name = text.slice(nameStart, nameEnd);
  const after = text[nameEnd];
  if (after === ">") return { name, bodyStart: nameEnd + 1 };
  if (after === void 0 || !TAG_ATTRIBUTE_LEAD.test(after)) return null;

  const end = tagEndAtOrAfter(text, tagEnds, nameEnd + 1);
  return end === -1 ? null : { name, bodyStart: end + 1 };
}

function tagEndAtOrAfter(text: string, scan: TagEndScan, from: number): number {
  if (from < scan.from || (scan.at !== -1 && from > scan.at)) {
    scan.from = from;
    scan.at = text.indexOf(">", from);
  }

  return scan.at;
}

function closeTagAtOrAfter({
  closesByName,
  closeCursors,
  name,
  from,
}: {
  closesByName: Map<string, number[]>;
  closeCursors: Map<string, number>;
  name: string;
  from: number;
}): number | null {
  const positions = closesByName.get(name);
  if (positions === void 0) return null;

  let cursor = closeCursors.get(name) ?? 0;
  while (cursor < positions.length && positions[cursor]! < from) cursor += 1;
  closeCursors.set(name, cursor);
  return positions[cursor] ?? null;
}
