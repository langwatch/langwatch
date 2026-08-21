// ADR-094 Decision 5. Which report bucket a usage row can belong to is decided
// AT INGEST, by the adapter, from provider metadata — never inferred at report
// time from a missing link, because "no link yet" and "can never have one" are
// different answers and merging them silently reclassifies every unlinked
// person as a bot.
//
// This module is the single place that mapping is written down. The ingest
// side stamps it; the report side reads it back. Two copies of this table
// would be two answers to "whose money is this".

/**
 * What kind of principal a usage row's actor is.
 *
 * - `person` — a human, so the row is ATTRIBUTED once a link exists and
 *   UNATTRIBUTED (fixable by linking) until then.
 * - `service_principal` / `bot` — can never resolve to a person, so the row is
 *   UNATTRIBUTABLE and shown on its own line rather than as a link somebody
 *   should go and create.
 */
export const ACTOR_KINDS = ["person", "service_principal", "bot"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * The default when a provider tells us nothing. `person` on purpose (Decision
 * 5): an unmarked person shows up as unattributed and an admin can fix it,
 * while an unmarked bot would hide a fixable row behind "can never resolve".
 * Only the recoverable mistake is acceptable as a default.
 */
export const DEFAULT_ACTOR_KIND: ActorKind = "person";

export const isActorKind = (value: unknown): value is ActorKind =>
  typeof value === "string" &&
  (ACTOR_KINDS as readonly string[]).includes(value);

export const toActorKind = (value: unknown): ActorKind =>
  isActorKind(value) ? value : DEFAULT_ACTOR_KIND;

/**
 * OCSF `user.type_id` (Unknown 0 / User 1 / Admin 2 / System 3 / Other 99).
 * It is the coarse, standard reading a SIEM already understands; the exact
 * bucket travels beside it as `user.type`, which is what the report reads.
 * Both are written, so neither side has to guess which one is authoritative:
 * `type` is.
 */
export const OCSF_USER_TYPE_ID_BY_ACTOR_KIND: Record<ActorKind, number> = {
  person: 1,
  service_principal: 3,
  bot: 3,
};

/**
 * The `actor.user` type fields for one row. Deterministic in its input — a
 * re-pulled event produces byte-identical JSON, which is what ADR-088's
 * restatement path needs to overwrite a row without changing it.
 */
export const ocsfActorType = (
  actorKind: ActorKind,
): { type_id: number; type: ActorKind } => ({
  type_id: OCSF_USER_TYPE_ID_BY_ACTOR_KIND[actorKind],
  type: actorKind,
});

/**
 * Read the bucket back out of a stored OCSF row — the exact inverse of
 * `ocsfActorType`, deliberately living beside it so ingest and report cannot
 * drift into two answers about whose money a row is.
 *
 * `type` is authoritative and is tried first, because `type_id` is lossy: OCSF
 * has no separate code for "bot", so a service principal and a bot both write
 * 3, and a report that read only the id could never tell them apart. `type_id`
 * is the fallback for rows written before the exact bucket travelled beside it
 * (and for anything a SIEM rewrote), where 1/2 mean a human and 3 means the
 * machine side; that fallback cannot recover "bot", so it answers
 * `service_principal` — both are UNATTRIBUTABLE, so the report's answer is
 * unchanged either way.
 *
 * An unreadable row is a `person` (DEFAULT_ACTOR_KIND): the report must never
 * invent "can never resolve" for a row it merely failed to parse.
 */
export const actorKindFromOcsf = (actor: {
  type?: unknown;
  type_id?: unknown;
}): ActorKind => {
  if (isActorKind(actor.type)) return actor.type;

  const typeId =
    typeof actor.type_id === "number"
      ? actor.type_id
      : typeof actor.type_id === "string" && actor.type_id.trim() !== ""
        ? Number(actor.type_id)
        : Number.NaN;

  if (typeId === OCSF_USER_TYPE_ID_BY_ACTOR_KIND.service_principal)
    return "service_principal";
  return DEFAULT_ACTOR_KIND;
};

/**
 * Can this actor kind ever resolve to a person? `person` yes — it is either
 * ATTRIBUTED (a link exists) or UNATTRIBUTED (fixable by linking). Service
 * principals and bots never can, which is what UNATTRIBUTABLE means (Decision
 * 5), and is why the report reads the ingest-time mark rather than inferring
 * anything from a link being absent.
 */
export const isPersonKind = (actorKind: ActorKind): boolean =>
  actorKind === "person";
