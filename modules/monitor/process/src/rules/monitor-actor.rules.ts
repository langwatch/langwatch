import type { Actor } from "@langwatch/authorization";

/** The user a monitor write is recorded against; an API key or the system records none. */
export function monitorWriterOf(actor: Actor | null | undefined): { actorId: string | null } {
  return { actorId: actor?.type === "user" ? actor.id : null };
}
