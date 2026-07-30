/**
 * One event as a map projection's executor receives it: identity, the
 * platform accept time, the customer's `occurredAt`, and the untyped payload.
 * Handlers built on this type their own `data` against the schema they
 * handle; the envelope makes no claim about it.
 */
export interface LangyConversationDispatchedEvent {
  readonly id: string;
  readonly createdAt: number;
  readonly occurredAt: number;
  readonly type: string;
  readonly data: unknown;
}
