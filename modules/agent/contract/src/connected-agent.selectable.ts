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
