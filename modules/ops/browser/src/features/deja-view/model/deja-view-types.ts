export type AggregateResult = {
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  eventCount: number;
  lastEventTime: string;
};

export type EventResult = {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  /** Optional: JSON drops a key holding `undefined`. */
  payload?: unknown;
};

export const EVENT_TYPE_COLORS = [
  "blue",
  "green",
  "purple",
  "orange",
  "cyan",
  "pink",
  "teal",
  "yellow",
  "red",
] as const;
