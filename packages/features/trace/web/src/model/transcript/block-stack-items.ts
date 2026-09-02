import type { ContentBlock, KeyedContentBlock } from "./types";

type KeyedBlock<K extends ContentBlock["kind"]> = Extract<KeyedContentBlock, { kind: K }>;

export type StackItem =
  | { kind: "block"; block: KeyedContentBlock }
  | {
      kind: "tool_pair";
      use: KeyedBlock<"tool_use">;
      result: KeyedBlock<"tool_result"> | null;
    }
  | {
      kind: "orphan_result";
      result: KeyedBlock<"tool_result">;
    };

export function itemBlockKey(item: StackItem): string {
  if (item.kind === "tool_pair") return item.use.blockKey;
  if (item.kind === "orphan_result") return item.result.blockKey;
  return item.block.blockKey;
}

export function pairToolBlocks(blocks: KeyedContentBlock[]): StackItem[] {
  const out: StackItem[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    if (consumed.has(i)) continue;
    const b = blocks[i]!;
    if (b.kind === "tool_use") {
      let resultIdx = -1;
      for (let j = i + 1; j < blocks.length; j++) {
        if (consumed.has(j)) continue;
        const cand = blocks[j]!;
        if (cand.kind !== "tool_result") continue;
        if (b.id && cand.toolUseId) {
          if (cand.toolUseId === b.id) {
            resultIdx = j;
            break;
          }
          continue;
        }
        resultIdx = j;
        break;
      }
      const result = resultIdx >= 0 ? blocks[resultIdx] : undefined;
      if (result?.kind === "tool_result") {
        consumed.add(resultIdx);
        out.push({
          kind: "tool_pair",
          use: b,
          result,
        });
      } else {
        out.push({ kind: "tool_pair", use: b, result: null });
      }
      continue;
    }
    if (b.kind === "tool_result") {
      out.push({ kind: "orphan_result", result: b });
      continue;
    }
    out.push({ kind: "block", block: b });
  }
  return out;
}
