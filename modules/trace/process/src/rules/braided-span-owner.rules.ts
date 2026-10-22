import { type Authorization, isSpanBraidGrant, ownProjectIdReadBy } from "@langwatch/authorization";

/** Whether a proof reads any owner's spans through a braid (ADR-183 §5). */
export function readsBraidedSpans(authorization: Authorization): boolean {
  return authorization.grants.some(isSpanBraidGrant);
}

/** The owner a span row names, set only when it is not the reader's own (ADR-183 §5). */
export function braidedOwnerOf({
  authorization,
  tenantId,
}: {
  authorization: Authorization;
  tenantId: string | undefined;
}): { ownerProjectId: string } | Record<string, never> {
  if (tenantId === undefined || tenantId === "") return {};
  return tenantId === ownProjectIdReadBy(authorization) ? {} : { ownerProjectId: tenantId };
}

/** How a single-span read names its tenant: today's statement, one owner, or nothing to read. */
export type SingleSpanOwnerRead =
  | { kind: "plain" }
  | { kind: "braided"; ownerProjectId: string }
  | { kind: "unreadable" };

/** A proof without braids reads only its own span; under braids one owner, else the reader. */
export function singleSpanOwnerRead({
  authorization,
  ownerProjectId,
}: {
  authorization: Authorization;
  ownerProjectId?: string | undefined;
}): SingleSpanOwnerRead {
  if (readsBraidedSpans(authorization)) {
    return { kind: "braided", ownerProjectId: ownerProjectId ?? ownProjectIdReadBy(authorization) };
  }
  if (ownerProjectId === undefined || ownerProjectId === ownProjectIdReadBy(authorization)) {
    return { kind: "plain" };
  }
  return { kind: "unreadable" };
}

/** Whose span a selection names: the reader's own, or a braid owner's. */
export type SelectedSpanOwner = { kind: "reader" } | { kind: "braid"; ownerProjectId: string };

export function selectedSpanOwnerOf({
  authorization,
  ownerProjectId,
}: {
  authorization: Authorization;
  ownerProjectId?: string | undefined;
}): SelectedSpanOwner {
  const read = singleSpanOwnerRead({ authorization, ownerProjectId });
  if (read.kind !== "braided" || read.ownerProjectId === ownProjectIdReadBy(authorization)) {
    return { kind: "reader" };
  }
  return { kind: "braid", ownerProjectId: read.ownerProjectId };
}

/** A live braid as the span panel needs it: its condition text and the earliest span it shows. */
export interface BraidTerms {
  ownerProjectId: string;
  where: string | null;
  fromMs: number;
}

/** The conditions a braided span shows under; empty when a braid in its window shows every span. */
export function braidConditionsShownFor({
  braids,
  ownerProjectId,
  spanStartedAtMs,
}: {
  braids: readonly BraidTerms[];
  ownerProjectId: string;
  spanStartedAtMs: number;
}): string[] {
  const inWindow = braids.filter(
    (braid) => braid.ownerProjectId === ownerProjectId && braid.fromMs <= spanStartedAtMs,
  );
  const conditions = inWindow.map((braid) => braid.where?.trim() ?? "");
  return conditions.includes("") ? [] : [...new Set(conditions)];
}
