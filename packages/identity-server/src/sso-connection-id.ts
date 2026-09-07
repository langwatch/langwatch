import { generate } from "@langwatch/ksuid";
import { createHash } from "node:crypto";

/**
 * SSO connection identity (D04) — the analogue of `identity-command-id.ts`
 * one aggregate over. Every form a connection id or a connection command id
 * takes lives here, so the string that decides whether a second migration
 * pass is the same command is never a template literal three modules apart
 * from the one it has to agree with.
 *
 * These strings are a persisted contract: changing one makes every prior
 * command a different command, so a pass would restate history that is
 * already in the log. Add a form; never edit one.
 */

/** A connection a human registered — random, minted once. */
export function newSsoConnectionId(): string {
  return generate("ssoc").toString();
}

/**
 * The resumable identity of one administrator's ordinary registration.
 *
 * The registration slot is written before the event append. A random id on
 * every HTTP retry therefore strands a successful reservation when that
 * append is interrupted. The actor is part of the seed so a different
 * administrator cannot accidentally resume or adopt somebody else's attempt.
 */
export function selfServeRegistrationConnectionId({
  organizationId,
  actorUserId,
  previousTerminal,
}: {
  organizationId: string;
  actorUserId: string;
  previousTerminal?: { connectionId: string; updatedAtMs: number };
}): string {
  const attemptSeed = previousTerminal
    ? `${previousTerminal.connectionId}\0${previousTerminal.updatedAtMs}`
    : "initial";
  const digest = createHash("sha256")
    .update(`${organizationId}\0${actorUserId}\0${attemptSeed}`)
    .digest("hex")
    .slice(0, 24);
  return `ssoc_selfserve_${digest}`;
}

/** The idempotency key shared by retries of an ordinary registration. */
export function selfServeRegistrationCommandId({
  organizationId,
  connectionId,
  actorUserId,
}: {
  organizationId: string;
  connectionId: string;
  actorUserId: string;
}): string {
  return `self-serve:register:${organizationId}:${actorUserId}:${connectionId}`;
}

/**
 * Whether a string is SHAPED like a connection id.
 *
 * A pre-filter and never the decision: what settles it is the row. better-auth
 * stores the connection id as an account's provider, so every OAuth account
 * the deployment mints — google, github, the brokered one — passes the same
 * seam as a connection arrival, and asking the database about each of them is
 * a round trip to learn "no". The prefix is a persisted contract stated at the
 * top of this file, so reading it here costs nothing and commits to nothing.
 *
 * The environment prefixes ksuids (`local_ssoc_...`), and `ssocmd_` is a
 * different form, so the underscore on both sides is load-bearing.
 */
export function looksLikeSsoConnectionId(value: string): boolean {
  return /(?:^|_)ssoc_/.test(value);
}

/** A live ops or self-service action's command id. */
export function newSsoConnectionCommandId(): string {
  return generate("ssocmd").toString();
}

/**
 * The durable recovery reservation for one human transition to ACTIVE.
 * Retries by the same actor against the same projected generation reuse it;
 * another actor or any intervening state change cannot adopt it.
 */
export function activationRecoveryReservationId({
  organizationId,
  connectionId,
  actorType,
  actorId,
  connectionUpdatedAtMs,
  transition,
}: {
  organizationId: string;
  connectionId: string;
  actorType: string;
  actorId: string | null;
  connectionUpdatedAtMs: number;
  transition: "activate" | "resume";
}): string {
  const digest = createHash("sha256")
    .update(
      `${organizationId}\0${connectionId}\0${actorType}\0${actorId ?? "system"}\0${connectionUpdatedAtMs}\0${transition}`,
    )
    .digest("hex")
    .slice(0, 32);
  return `sso-recovery:${digest}`;
}

/** One way back in, granted to one person until one date (D05). Minted here
 *  rather than beside the connection ids' consumers for the same reason they
 *  are: an id prefix is a persisted contract. */
export function newSsoBreakGlassBindingId(): string {
  return generate("ssobg").toString();
}

/**
 * Whether an id names a connection — in any form above, under any environment
 * prefix (`generate` prefixes everything but production).
 *
 * Asked by the legacy storage branch, which has to tell two provider ids apart
 * that look identical to it: one whose issuer we MINT synthetically, and one
 * that brings a real issuer of its own. Only a connection does the latter, so
 * only a connection may be found by a provider id standing beside an issuer
 * the `Account` table could never have stored.
 *
 * `ssocmd_` and `ssobg_` deliberately do not match: neither ever appears as a
 * provider id, and a prefix test loose enough to catch them would be loose
 * enough to catch the next id minted with an `ssoc` stem.
 */
export function isSsoConnectionId(id: string): boolean {
  return id.startsWith("ssoc_") || id.includes("_ssoc_");
}

/**
 * The connection the grandfather migration creates for an organization.
 * Derived from the organization so every pass names the same aggregate —
 * which is what lets the guard answer "this already exists" rather than
 * minting a second connection for the same two strings.
 */
export function grandfatheredSsoConnectionId({
  organizationId,
}: {
  organizationId: string;
}): string {
  return `ssoc_gf_${organizationId}`;
}

/**
 * The grandfather pass's command id (ADR-117 §5: idempotency keys
 * `grandfather:<orgId>`). The facts it states key off
 * `<commandId>:<index>`, so a second pass derives byte-identical keys and
 * the event store dedupes every one of them.
 */
export function grandfatherCommandId({
  organizationId,
}: {
  organizationId: string;
}): string {
  return `grandfather:${organizationId}`;
}

/**
 * The one direct replacement for one grandfathered connection. Concurrent
 * setup requests must address the same aggregate; a random id lets each
 * request append a durable registration before projection uniqueness can
 * reject the loser.
 */
export function legacyReplacementConnectionId({
  organizationId,
  legacyConnectionId,
  previousTerminal,
}: {
  organizationId: string;
  legacyConnectionId: string;
  previousTerminal?: { connectionId: string; updatedAtMs: number };
}): string {
  const attemptSeed = previousTerminal
    ? `${previousTerminal.connectionId}\0${previousTerminal.updatedAtMs}`
    : "initial";
  const digest = createHash("sha256")
    .update(`${organizationId}\0${legacyConnectionId}\0${attemptSeed}`)
    .digest("hex")
    .slice(0, 24);
  return `ssoc_replacement_${digest}`;
}

/** The idempotency key shared by every retry of that replacement setup. */
export function legacyReplacementCommandId({
  organizationId,
  legacyConnectionId,
  replacementConnectionId,
}: {
  organizationId: string;
  legacyConnectionId: string;
  replacementConnectionId: string;
}): string {
  return `legacy-migration:start:${organizationId}:${legacyConnectionId}:${replacementConnectionId}`;
}
