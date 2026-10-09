import { generate } from "@langwatch/ksuid";

/**
 * Two-step verification identity (D06) — the analogue of `join-request-id.ts`
 * one aggregate over. Every form an enrollment id or a two-step command id
 * takes lives here, so the string that decides whether a retry is the same
 * command is never a template literal three modules apart from the one it has
 * to agree with.
 *
 * These strings are a persisted contract: changing one makes every prior
 * command a different command. Add a form; never edit one.
 */

/** A setup somebody started — random, minted once. */
export function newMfaEnrollmentId(): string {
  return generate("mfaenr").toString();
}

/**
 * The command id a CEREMONY dispatches with.
 *
 * Derived from the person, the verb and the moment the ceremony's endpoint
 * answered, rather than minted fresh: better-auth retries an endpoint on a
 * transient failure, and a retry of one ceremony has to be the same command
 * or the log would carry a second confirmation of the same setup.
 */
export function mfaCeremonyCommandId({
  userId,
  verb,
  occurredAtMs,
}: {
  userId: string;
  verb: string;
  occurredAtMs: number;
}): string {
  return `mfa-ceremony:${verb}:${userId}:${occurredAtMs}`;
}
