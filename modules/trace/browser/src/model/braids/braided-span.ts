import type { BraidedOwner, SpanTreeNode } from "@langwatch/trace-contract";

/** How a braided span is drawn: the project it came from, by name. */
export interface BraidStrand {
  ownerProjectId: string;
  ownerName: string;
}

export const BRAIDED_ACTION_DISABLED_REASON = "Not available on spans braided from another project";

/**
 * One key per span in the tree. The reader's own spans keep their span id;
 * a braided span is keyed by its owner too, so two projects holding one
 * span id stay two spans (ADR-183 §5).
 */
export function spanNodeKey(span: Pick<SpanTreeNode, "spanId" | "ownerProjectId">): string {
  return span.ownerProjectId ? JSON.stringify([span.ownerProjectId, span.spanId]) : span.spanId;
}

/** A braided span's strand: its owner's name from the header; null on an own span. */
export function braidStrandFor({
  ownerProjectId,
  owners,
}: {
  ownerProjectId: string | null | undefined;
  owners: readonly BraidedOwner[] | null | undefined;
}): BraidStrand | null {
  if (!ownerProjectId) return null;
  return {
    ownerProjectId,
    ownerName:
      owners?.find((owner) => owner.projectId === ownerProjectId)?.name ?? "another project",
  };
}

/** Rough text widths in the tree's type sizes, and what a row and a badge spend around them. */
const SPAN_NAME_CHAR_PX = 7;
const OWNER_NAME_CHAR_PX = 6;
const BADGE_CHROME_PX = 36;
const ROW_CHROME_PX = 80;
const INDENT_PX = 20;

/**
 * Whether a row's badge is the mark alone: when the span's name and the owner's whole name do not
 * both fit. The span's name comes first and neither name is cut short for the badge.
 */
export function braidBadgeIsCompact({
  treeWidthPx,
  depth,
  spanName,
  ownerName,
}: {
  treeWidthPx: number;
  depth: number;
  spanName: string;
  ownerName: string;
}): boolean {
  const room = treeWidthPx - depth * INDENT_PX - ROW_CHROME_PX;
  const needed =
    spanName.length * SPAN_NAME_CHAR_PX + ownerName.length * OWNER_NAME_CHAR_PX + BADGE_CHROME_PX;
  return room < needed;
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
