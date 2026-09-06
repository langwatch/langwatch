/**
 * Whether the caller reading a connected agent can also choose it (ADR-128).
 *
 * A development agent registered with a personal key belongs to that person,
 * and only that person can run it. Everybody in the project can still READ the
 * row: one name and one environment can hold a personal row and a host-scoped
 * row at once, and a listing that dropped the personal one would show two
 * agents of one name with no way to tell them apart.
 *
 * So a listing carries every row the caller may read, and each row says
 * whether the caller may choose it. The rule is here, in one framework-free
 * module, because three readers have to agree on it: the listings that mark
 * the rows, the run that refuses a target, and the browser that draws the
 * picker. Two copies of it is how a row marked selectable becomes a run that
 * refuses.
 *
 * @see specs/agents/connected-agents.feature
 */
import { explainHandledError } from "@langwatch/handled-error/presentation";

/** Why a row is listed but cannot be chosen. */
export const CONNECTED_AGENT_NOT_SELECTABLE_REASONS = ["owned_by_another_person"] as const;

export type ConnectedAgentNotSelectableReason =
  (typeof CONNECTED_AGENT_NOT_SELECTABLE_REASONS)[number];

/** What every listing says about a row beside its owner. */
export interface ConnectedAgentSelectability {
  selectable: boolean;
  notSelectableReason: ConnectedAgentNotSelectableReason | null;
}

/**
 * Whether this caller can choose this agent, and why not when they cannot.
 *
 * A row that belongs to nobody is everybody's to choose. A row that belongs to
 * a person is theirs alone, so a caller who is somebody else, or a key that
 * names no person at all, reads it but cannot choose it.
 */
export function connectedAgentSelectability({
  ownerUserId,
  viewerUserId,
}: {
  ownerUserId: string | null | undefined;
  /** The person behind the caller; nothing for a key that names none. */
  viewerUserId: string | null | undefined;
}): ConnectedAgentSelectability {
  if (!ownerUserId || ownerUserId === viewerUserId) {
    return { selectable: true, notSelectableReason: null };
  }
  return { selectable: false, notSelectableReason: "owned_by_another_person" };
}

/**
 * Why a teammate's development agent cannot be picked, in the words the
 * product already uses for that refusal. The picker, the card chip and the
 * refused run all read this one line, so a tooltip never disagrees with the
 * error the run answers with.
 */
export function ownerOnlyCopy(ownerName?: string | null): string {
  const explanation = explainHandledError({
    code: "agent_owner_only",
    meta: ownerName ? { ownerName } : {},
    httpStatus: 403,
    fault: "customer",
    retryable: false,
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  return explanation.description || explanation.title;
}
