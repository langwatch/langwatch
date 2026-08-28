/**
 * Who started a run.
 *
 * A run records the person who started it, never the machine that ran it. The
 * record is a stable id and the surface that person acted through, the same
 * pair a scenario version stores as `authorId` and `authorLabel`, so the two
 * records read the same way.
 *
 * The id is what makes the record stable: a person can rename themselves, and
 * a run from last month must still point at them, so no name is stored.
 *
 * It travels in the reserved `langwatch` namespace of the run metadata, beside
 * the scenario version, because it is platform context and not something an
 * SDK caller sets. That namespace passes through into the stored run metadata,
 * so it needs no column of its own.
 *
 * A caller that names no person records no actor. There is no placeholder.
 *
 * @see specs/scenarios/run-actor-on-runs.feature
 */

import { z } from "zod";

/** The surfaces a person can start a run through. */
export const RUN_ACTOR_LABELS = ["user", "api", "cli"] as const;
export type RunActorLabel = (typeof RUN_ACTOR_LABELS)[number];

export const runActorLabelSchema = z.enum(RUN_ACTOR_LABELS);

/** The person a run is recorded against, and how they reached it. */
export type RunActor = {
  /** The platform user id. */
  id: string;
  label: RunActorLabel;
};

/**
 * The `actorId` and `actorLabel` entries of the reserved namespace, or nothing
 * at all.
 *
 * Both fields are written together or neither is: a surface with no person
 * behind it says nothing, rather than recording a label every reader would
 * have to filter out.
 */
export function withActor(
  actor: RunActor | undefined,
): { actorId: string; actorLabel: RunActorLabel } | Record<string, never> {
  return actor?.id ? { actorId: actor.id, actorLabel: actor.label } : {};
}

/**
 * The actor of a REST call, or nothing when the credential names no person.
 *
 * A project key belongs to no user, so it records no actor. The `langwatch`
 * CLI declares itself with `X-LangWatch-Surface: cli`; only that value is
 * honored, so a caller cannot claim an in-app surface over the wire.
 */
export function runActorFromRequest(params: {
  userId: string | null | undefined;
  surfaceHeader: string | null | undefined;
}): RunActor | undefined {
  if (!params.userId) return undefined;
  const declared = params.surfaceHeader?.toLowerCase();
  return { id: params.userId, label: declared === "cli" ? "cli" : "api" };
}
