import { ConfigurationError, validateMount, type Mount } from "@langwatch/event-sourcing";

/** Both folds write Postgres; both maps append. There is no third contract. */
export const langyConversationStateMount: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

/** The spine's shape on a narrower lane: one turn, not one conversation. */
export const langyConversationTurnMount: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

/** An event-scoped lane can never batch. Duplicate rows collapse at the
 *  store on the message's own `(projectId, ConversationId, MessageId)` key. */
export const langyMessageOperationalMount: Mount = {
  projection: "map",
  store: "append",
  scope: "event",
  collapse: "none",
};

/** One lane per conversation, so a conversation's analytics events coalesce
 *  into one ClickHouse insert. */
export const langyAnalyticsEventMount: Mount = {
  projection: "map",
  store: "append",
  scope: "aggregate",
  collapse: "batch",
};

const MOUNTS: Readonly<Record<string, Mount>> = {
  langyConversationState: langyConversationStateMount,
  langyConversationTurn: langyConversationTurnMount,
  langyMessageOperational: langyMessageOperationalMount,
  langyAnalyticsEvent: langyAnalyticsEventMount,
};

/** Refusal happens at composition, not on the first delivery (ADR-106). */
export function assertLangyConversationProcessingMountsAreLegal(): void {
  const violations: string[] = [];
  for (const [name, mount] of Object.entries(MOUNTS)) {
    for (const v of validateMount(mount)) {
      violations.push(`${name}: ${v.rule} — ${v.message}`);
    }
  }
  if (violations.length > 0) {
    throw new ConfigurationError(
      `langy-conversation-processing has illegal mounts: ${violations.join("; ")}`,
      { pipeline: "langy_conversation_processing", violations },
    );
  }
}
