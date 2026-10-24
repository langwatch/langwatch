import {
  type Authorization,
  braidConditionTermsOf,
  isSpanBraidGrant,
  ownProjectIdReadBy,
  VERIFIED_ATTRIBUTE_PREFIX,
} from "@langwatch/authorization";
import { compileBraidCondition } from "@langwatch/authz-contract/braid-condition-compiler";

/** Whether a proof reads any owner's spans through a braid (ADR-185 §5). */
export function readsBraidedSpans(authorization: Authorization): boolean {
  return authorization.grants.some(isSpanBraidGrant);
}

/**
 * Protects each braid owner's items under that owner's protections and the reader's under the
 * reader's, keeping their order (ADR-185 §5). An owner with no protections resolved hides all.
 */
export function protectByOwner<T extends { ownerProjectId?: string | null | undefined }, R, P>({
  items,
  reader,
  owners,
  protect,
}: {
  items: readonly T[];
  reader: P;
  owners: ReadonlyMap<string, P>;
  protect: (group: T[], protections: P) => R[];
}): R[] {
  const groups = new Map<string | null, number[]>();
  items.forEach((item, index) => {
    const owner = item.ownerProjectId ?? null;
    groups.set(owner, [...(groups.get(owner) ?? []), index]);
  });
  const protectedItems: R[] = [];
  for (const [owner, indexes] of groups) {
    const protections = owner === null ? reader : owners.get(owner);
    if (protections === undefined) throw new Error(`no protections resolved for owner ${owner}`);
    const protectedGroup = protect(
      indexes.map((index) => items[index]!),
      protections,
    );
    indexes.forEach((index, position) => {
      protectedItems[index] = protectedGroup[position]!;
    });
  }
  return protectedItems;
}

/** Whether a trace-view read shows owners' spans: it reads `spans` under a braid (ADR-185 §5). */
export function readsOwnersSpans({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads?: "spans" | "traces" | undefined;
}): boolean {
  return reads === "spans" && readsBraidedSpans(authorization);
}

/** The owner a span row names, set only when it is not the reader's own (ADR-185 §5). */
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringLeavesAt = ({ value, path }: { value: unknown; path: string }): string[][] => {
  if (typeof value === "string") return [[path, value]];
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    stringLeavesAt({ value: child, path: path === "" ? key : `${path}.${key}` }),
  );
};

/** One verified mark (ADR-185 §4): the signed entry key and the project it names. */
export interface VerifiedMark {
  key: string;
  projectId: string;
}

/** A span's verified marks, read from its `params` however far they are unflattened. */
export function verifiedMarksOf({ params }: { params: unknown }): VerifiedMark[] {
  const marks = stringLeavesAt({ value: params, path: "" }).flatMap(
    ([path = "", projectId = ""]) =>
      path.startsWith(VERIFIED_ATTRIBUTE_PREFIX)
        ? [{ key: path.slice(VERIFIED_ATTRIBUTE_PREFIX.length), projectId }]
        : [],
  );
  return [
    ...new Map(marks.map((mark) => [JSON.stringify([mark.key, mark.projectId]), mark])).values(),
  ];
}

/** A live braid as the span panel needs it: its condition text and the earliest span it shows. */
export interface BraidTerms {
  ownerProjectId: string;
  where: string | null;
  fromMs: number;
}

/** The keys a condition's `Verified("k")` terms name; none for an empty or refused one. */
function verifiedKeysIn(where: string | null): string[] {
  const compiled = compileBraidCondition({ text: where ?? "" });
  if (!compiled.ok || compiled.compiledWhere === undefined) return [];
  return braidConditionTermsOf(compiled.compiledWhere.tree).flatMap((term) =>
    term.kind === "verified" ? [term.key] : [],
  );
}

/**
 * The conditions a braided span shows under; empty when a braid in its window shows every span.
 * A condition is joined by `and` only, so one naming `Verified("k")` shows a span only when the
 * span's mark under k names the reader (ADR-185 §4); the others are left out.
 */
export function braidConditionsShownFor({
  braids,
  ownerProjectId,
  spanStartedAtMs,
  signedKeys,
}: {
  braids: readonly BraidTerms[];
  ownerProjectId: string;
  spanStartedAtMs: number;
  /** The keys of the span's verified marks that name the reader. */
  signedKeys: ReadonlySet<string>;
}): string[] {
  const inWindow = braids.filter(
    (braid) => braid.ownerProjectId === ownerProjectId && braid.fromMs <= spanStartedAtMs,
  );
  const held = inWindow.filter((braid) =>
    verifiedKeysIn(braid.where).every((key) => signedKeys.has(key)),
  );
  const conditions = (held.length > 0 ? held : inWindow).map((braid) => braid.where?.trim() ?? "");
  return conditions.includes("") ? [] : [...new Set(conditions)];
}
