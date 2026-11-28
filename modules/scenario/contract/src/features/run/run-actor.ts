/** Who started a run: person id and surface (user/api/cli); travels in the
 * reserved langwatch metadata namespace.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The surfaces a person can start a run through. */
export const RUN_ACTOR_LABELS = ["user", "api", "cli"] as const;
export type RunActorLabel = (typeof RUN_ACTOR_LABELS)[number];

export const runActorLabelSchema = z.enum(RUN_ACTOR_LABELS);

/** Who a run is recorded against: a person, the key it was started with, or both. */
const runActorSchemaDefinition = z
  .object({
    /** The platform user id; absent when the starting key belongs to no person. */
    id: z.string().min(1).optional(),
    label: runActorLabelSchema,
    /** The API key the run was started with; the run's own key holds no more than it. */
    apiKeyId: z.string().min(1).optional(),
  })
  .strict()
  .refine((actor) => actor.id !== undefined || actor.apiKeyId !== undefined, {
    message: "A run actor names a person, a starting key, or both",
  });
export interface RunActorSchema extends Named<typeof runActorSchemaDefinition> {}
export const runActorSchema: RunActorSchema = runActorSchemaDefinition;
export type RunActor = z.infer<typeof runActorSchema>;

/** The person a run reads back as started by: only a run that names a person records one. */
export type RecordedRunActor = { id: string; label: RunActorLabel };

/**
 * The reserved namespace entries of an actor. `actorId` and `actorLabel` are written together or
 * not at all, so a key with no person behind it records no actor, only `actorApiKeyId`: the key
 * the run's own key is minted under.
 */
export function withActor(actor: RunActor | undefined): {
  actorId?: string;
  actorLabel?: RunActorLabel;
  actorApiKeyId?: string;
} {
  const key = actor?.apiKeyId ? { actorApiKeyId: actor.apiKeyId } : {};
  if (!actor?.id) return key;

  return { actorId: actor.id, actorLabel: actor.label, ...key };
}

/**
 * The actor of a REST call: the person the key belongs to and the key itself, or the key alone
 * when it belongs to no person. Nothing when the credential is neither. Only
 * `X-LangWatch-Surface: cli` is honored, so a caller cannot claim an in-app surface.
 */
export function deriveRunActor(params: {
  userId: string | null | undefined;
  surfaceHeader: string | null | undefined;
  apiKeyId?: string | null | undefined;
}): RunActor | undefined {
  if (!params.userId && !params.apiKeyId) return undefined;
  const declared = params.surfaceHeader?.toLowerCase();
  return {
    ...(params.userId ? { id: params.userId } : {}),
    label: declared === "cli" ? "cli" : "api",
    ...(params.apiKeyId ? { apiKeyId: params.apiKeyId } : {}),
  };
}
