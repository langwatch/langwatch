import type { ContentBlock, KeyedContentBlock } from "./types";

const FIELD_SEPARATOR = "\u0000";

function canonicalBlockContent(block: ContentBlock): string {
  switch (block.kind) {
    case "text":
    case "thinking":
      return block.text;
    case "tool_use":
      return [block.id ?? "", block.name, describeValue(block.input)].join(FIELD_SEPARATOR);
    case "tool_result":
      return [
        block.toolUseId ?? "",
        block.isError ? "error" : "ok",
        describeValue(block.content),
      ].join(FIELD_SEPARATOR);
    case "media":
      return describeValue(block.part);
    case "raw":
      return describeValue(block.data);
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function hashContent(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function blockContentKey(block: ContentBlock): string {
  const content = canonicalBlockContent(block);
  return `${block.kind}-${content.length.toString(36)}-${hashContent(content)}`;
}

export function withBlockKeys(blocks: ContentBlock[], prefix = ""): KeyedContentBlock[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const base = blockContentKey(block);
    const before = seen.get(base) ?? 0;
    seen.set(base, before + 1);
    const key = before === 0 ? base : `${base}~${before}`;
    return { ...block, blockKey: prefix ? `${prefix}/${key}` : key };
  });
}
