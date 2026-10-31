import { explainHandledError } from "@langwatch/handled-error/presentation";

import type { AgentHooks } from "./connected-agent.protocol.ts";

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

/** The docs page on hooks that live in the agent's own code. */
export const HOOKS_DOCS_URL = "https://langwatch.ai/docs/agent-testing/setup-and-teardown-hooks";

/** What to tell about hooks: the declared ones while the agent is online, else the general line. */
export function connectedAgentHooksCopy({
  isOnline,
  hooks,
}: {
  isOnline: boolean;
  hooks?: Partial<AgentHooks>;
}): string {
  if (!isOnline) {
    return "Setup and teardown hooks run from this agent's code, before and after each scenario run.";
  }
  if (hooks?.setup && hooks.teardown) {
    return "This agent's code declares setup and teardown hooks; they run before and after each scenario run.";
  }
  if (hooks?.setup) {
    return "This agent's code declares a setup hook; it runs before each scenario run.";
  }
  if (hooks?.teardown) {
    return "This agent's code declares a teardown hook; it runs after each scenario run.";
  }
  return "No setup or teardown hooks declared. Add them in the agent's code.";
}
