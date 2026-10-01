import type { SsoConnectionRegistrationSlot } from "../repositories/sso-connection-registration.repository.ts";
import { SSO_CONNECTION_TERMINAL_STATES } from "./sso-domain-ownership.rules.ts";

/**
 * Whether a slot still stands in the way. A slot whose connection row is
 * absent counts as LIVE: the row and the slot are written in separate steps,
 * so an absent row is as likely a claim half-made as one cleaned up.
 */
function slotIsLive({
  slot,
  stateByConnection,
}: {
  slot: SsoConnectionRegistrationSlot;
  stateByConnection: ReadonlyMap<string, string>;
}): boolean {
  const state = stateByConnection.get(slot.connectionId);
  return state === undefined || !SSO_CONNECTION_TERMINAL_STATES.some((gone) => gone === state);
}

/**
 * The slots that refuse this claim; empty when it may proceed. Refused when
 * its own kind is held by another live connection, or the opposite kind is
 * held by a connection it is not the exact migration counterpart of.
 */
export function findBlockingRegistrationSlots({
  candidate,
  slots,
  stateByConnection,
}: {
  candidate: SsoConnectionRegistrationSlot;
  slots: readonly SsoConnectionRegistrationSlot[];
  stateByConnection: ReadonlyMap<string, string>;
}): SsoConnectionRegistrationSlot[] {
  const held = slots.find((slot) => slot.kind === candidate.kind);
  if (
    held &&
    held.connectionId !== candidate.connectionId &&
    slotIsLive({ slot: held, stateByConnection })
  ) {
    return [held];
  }

  const opposite = slots.find((slot) => slot.kind !== candidate.kind);
  if (!opposite || !slotIsLive({ slot: opposite, stateByConnection })) return [];
  const exactPair =
    candidate.kind === "direct"
      ? candidate.replacesConnectionId === opposite.connectionId
      : opposite.replacesConnectionId === candidate.connectionId;
  return exactPair ? [] : [opposite];
}
