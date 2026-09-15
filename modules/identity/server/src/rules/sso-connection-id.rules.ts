import { generate } from "@langwatch/ksuid";

/**
 * SSO connection identity (D04), the analogue of `identity-command-id.ts`.
 * A persisted contract — changing a form makes every prior command a
 * different one, restating history already in the log. Add; never edit.
 */

/** A connection a human registered — random, minted once. */
export function newSsoConnectionId(): string {
  return generate("ssoc").toString();
}

/** A live ops or self-service action's command id. */
export function newSsoConnectionCommandId(): string {
  return generate("ssocmd").toString();
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
export function grandfatherCommandId({ organizationId }: { organizationId: string }): string {
  return `grandfather:${organizationId}`;
}
