import {
  ACTOR_KINDS,
  type ActorKind,
  DEFAULT_ACTOR_KIND,
} from "@langwatch/identity-links";
import { z } from "zod";

/**
 * The two actor fields ADR-094 added to the canonical pull event, declared as
 * mapping so the generic pullers (and every reference puller built on them)
 * can produce them without a bespoke adapter each.
 *
 * `actor_id` is a plain JSONPath — the PROVIDER's id for the person. Whoever
 * writes the mapping must pick a path in the same id namespace as one of that
 * provider's declared `externalKind`s (see `EXTERNAL_KINDS_BY_PROVIDER`): a
 * report joins the link list on this value, so a namespace mismatch does not
 * error, it just never matches.
 *
 * `actor_kind` is a path plus a declared value table, rather than a path
 * alone, because providers spell "this was a service principal" in their own
 * vocabulary (Microsoft sends `UserType: 6`) and the translation into ADR-094
 * Decision 5's three buckets has to be written down once, per adapter, in the
 * frozen mapping — not guessed per event.
 */
export const actorMappingFields = {
  actor_id: z.string().optional(),
  actor_kind: z
    .object({
      /** Where the provider's own principal-type value lives. */
      path: z.string().min(1),
      /** That provider's value → our bucket. Unlisted values fall through. */
      byValue: z.record(z.enum(ACTOR_KINDS)).default({}),
      /**
       * For providers that signal the principal type by which FIELD they
       * populate rather than by a value: Microsoft's directory audit puts
       * `initiatedBy.app` on an application-initiated event and
       * `initiatedBy.user` on a human one, so the app id existing at all is
       * the whole signal and there is no value to enumerate.
       */
      whenPresent: z.enum(ACTOR_KINDS).optional(),
    })
    .optional(),
} as const;

export type ActorKindMapping = z.infer<
  (typeof actorMappingFields)["actor_kind"]
>;

/**
 * Translate a provider's principal-type value into a bucket.
 *
 * Anything unrecognised — no mapping declared, path missing from this event,
 * value not in the table — is a `person` (ADR-094 Decision 5). That is the
 * recoverable mistake: an unmarked person shows up as unattributed and an
 * admin can link them, while an unmarked bot would hide a fixable row behind
 * "can never resolve".
 */
export const resolveActorKind = ({
  mapping,
  read,
}: {
  mapping: ActorKindMapping | undefined;
  read: (path: string) => unknown;
}): ActorKind => {
  if (!mapping) return DEFAULT_ACTOR_KIND;
  const raw = read(mapping.path);
  if (raw === undefined || raw === null || raw === "")
    return DEFAULT_ACTOR_KIND;
  return (
    mapping.byValue[String(raw)] ?? mapping.whenPresent ?? DEFAULT_ACTOR_KIND
  );
};
