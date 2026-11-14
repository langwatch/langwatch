import { Ksuid } from "@langwatch/ksuid";

import type { IdentityFact, IdentityHeads } from "./facts.ts";

/**
 * One identifier, two spellings (#9575): its id in the legacy and the v2 KSUID layout. A fact
 * naming the spelling a person does not hold, while they hold the other, is folded as naming
 * the held one, so a rollout or a rollback that derives the other layout adds no second row.
 */
export function heldIdentifierFact({
  heads,
  fact,
}: {
  heads: IdentityHeads;
  fact: IdentityFact;
}): IdentityFact {
  if (!("identifierId" in fact.data)) return fact;
  const named = fact.data.identifierId;
  if (named in heads.identifiers) return fact;
  const held = findOtherSpellings({ identifierId: named }).find((id) => id in heads.identifiers);
  if (held === undefined) return fact;
  return { ...fact, data: { ...fact.data, identifierId: held } } as IdentityFact;
}

/** The id in the other KSUID layout, when it differs; none for an id that is not a KSUID. */
function findOtherSpellings({ identifierId }: { identifierId: string }): string[] {
  let parsed: Ksuid;
  try {
    parsed = Ksuid.parse(identifierId);
  } catch {
    return [];
  }
  const twin = parsed.withLayout(parsed.layout === "v2" ? "v1-legacy" : "v2").toString();
  return twin === identifierId ? [] : [twin];
}
