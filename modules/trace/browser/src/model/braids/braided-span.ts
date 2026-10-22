import type { BraidedOwner, SpanTreeNode } from "@langwatch/trace-contract";

/** How a braided span is drawn: the owner's name and its strand colour token. */
export interface BraidStrand {
  ownerProjectId: string;
  ownerName: string;
  colour: string;
}

const STRAND_COUNT = 3;

export const BRAIDED_ACTION_DISABLED_REASON = "Not available on spans braided from another project";

/**
 * One key per span in the tree. The reader's own spans keep their span id;
 * a braided span is keyed by its owner too, so two projects holding one
 * span id stay two spans (ADR-183 §5).
 */
export function spanNodeKey(span: Pick<SpanTreeNode, "spanId" | "ownerProjectId">): string {
  return span.ownerProjectId ? JSON.stringify([span.ownerProjectId, span.spanId]) : span.spanId;
}

/** A braided span's strand, by its owner's order in the header; null on the reader's own span. */
export function braidStrandFor({
  ownerProjectId,
  owners,
}: {
  ownerProjectId: string | null | undefined;
  owners: readonly BraidedOwner[] | null | undefined;
}): BraidStrand | null {
  if (!ownerProjectId) return null;
  const index = owners?.findIndex((owner) => owner.projectId === ownerProjectId) ?? -1;
  const strand = (Math.max(index, 0) % STRAND_COUNT) + 1;
  return {
    ownerProjectId,
    ownerName: owners?.[index]?.name ?? "another project",
    colour: `feature.braids.project.${strand}`,
  };
}

/** "A", "A and B", "A, B and C". */
export function joinOwnerNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The project a selected span is read from: none when the reader holds that span id itself,
 * else the first braid owner holding it in the loaded tree.
 */
export function selectedSpanOwnerIn({
  nodes,
  spanId,
}: {
  nodes: readonly Pick<SpanTreeNode, "spanId" | "ownerProjectId">[] | undefined;
  spanId: string | null;
}): string | undefined {
  if (!spanId || !nodes) return undefined;
  let owner: string | undefined;
  for (const node of nodes) {
    if (node.spanId !== spanId) continue;
    if (!node.ownerProjectId) return undefined;
    owner ??= node.ownerProjectId;
  }
  return owner;
}
