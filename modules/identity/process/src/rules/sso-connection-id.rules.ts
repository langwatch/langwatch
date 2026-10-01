import { createHash } from "node:crypto";

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

/**
 * The break-glass recovery reservation an activation or resume holds. Retries
 * by the same actor against the same projected generation reuse it; another
 * actor, or any state change in between, cannot adopt it.
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

/** A live ops or self-service action's command id. */
export function newSsoConnectionCommandId(): string {
  return generate("ssocmd").toString();
}

/** One stored credential. Minted per WRITE, never reused: rotating a
 *  secret mints a new reference rather than overwriting a value. */
export function newSsoCredentialId(): string {
  return generate("ssocred").toString();
}

/**
 * The connection the grandfather migration creates for an organization,
 * derived from it so every pass names the same aggregate — letting the
 * guard answer "this already exists" rather than minting a second one.
 */
export function grandfatheredSsoConnectionId({
  organizationId,
}: {
  organizationId: string;
}): string {
  return `ssoc_gf_${organizationId}`;
}

/**
 * The grandfather pass's command id (ADR-117 §5). Facts key off
 * `<commandId>:<index>`, so a second pass derives byte-identical keys and
 * the event store dedupes them.
 */
export function grandfatherCommandId({ organizationId }: { organizationId: string }): string {
  return `grandfather:${organizationId}`;
}

/** One way back in, minted per GRANT: a renewal writes a new row naming the
 *  one it replaced, so no id is ever reused. */
export function newSsoBreakGlassBindingId(): string {
  return generate("ssobg").toString();
}

/** One recorded sign-in through a connection. */
export function newSsoAuthenticationActivityId(): string {
  return generate("ssoauth").toString();
}
