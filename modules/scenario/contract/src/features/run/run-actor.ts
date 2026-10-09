/** Who started a run: person id and surface (user/api/cli); travels in the
 * reserved langwatch metadata namespace.
 */

import { z } from "zod";

/** The surfaces a person can start a run through. */
export const RUN_ACTOR_LABELS = ["user", "api", "cli"] as const;
export type RunActorLabel = (typeof RUN_ACTOR_LABELS)[number];

export const runActorLabelSchema = z.enum(RUN_ACTOR_LABELS);

/** The person a run is recorded against, and how they reached it. */
export const runActorSchema = z
  .object({
    /** The platform user id. */
    id: z.string().min(1),
    label: runActorLabelSchema,
    /** The API key they started it with; the run's own key holds no more than it. */
    apiKeyId: z.string().min(1).optional(),
  })
  .strict();
export type RunActor = z.infer<typeof runActorSchema>;

/**
 * The `actorId` and `actorLabel` entries of the reserved namespace, or
 * nothing at all: both are written together, since a surface with no
 * person behind it should say nothing rather than a label to filter out.
 */
export function withActor(
  actor: RunActor | undefined,
): { actorId: string; actorLabel: RunActorLabel; actorApiKeyId?: string } | Record<string, never> {
  if (!actor?.id) return {};

  return {
    actorId: actor.id,
    actorLabel: actor.label,
    ...(actor.apiKeyId ? { actorApiKeyId: actor.apiKeyId } : {}),
  };
}

/**
 * The actor of a REST call, or nothing when the credential names no person
 * — a project key records no actor. Only `X-LangWatch-Surface: cli` is
 * honored, so a caller cannot claim an in-app surface over the wire.
 */
export function deriveRunActor(params: {
  userId: string | null | undefined;
  surfaceHeader: string | null | undefined;
  apiKeyId?: string | null | undefined;
}): RunActor | undefined {
  if (!params.userId) return undefined;
  const declared = params.surfaceHeader?.toLowerCase();
  return {
    id: params.userId,
    label: declared === "cli" ? "cli" : "api",
    ...(params.apiKeyId ? { apiKeyId: params.apiKeyId } : {}),
  };
}
