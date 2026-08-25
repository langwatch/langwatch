import { generate } from "@langwatch/ksuid";

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

/** A live ops or self-service action's command id. */
export function newSsoConnectionCommandId(): string {
  return generate("ssocmd").toString();
}

/** One way back in, granted to one person until one date (D05). Minted here
 *  rather than beside the connection ids' consumers for the same reason they
 *  are: an id prefix is a persisted contract. */
export function newSsoBreakGlassBindingId(): string {
  return generate("ssobg").toString();
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
