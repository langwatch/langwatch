/**
 * Base event type for the event sourcing system.
 */
export interface Event {
  id: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  timestamp: number;
  type: string;
  data: unknown;
  metadata?: {
    processingTraceparent?: string;
    spanId?: string;
    traceId?: string;
    [key: string]: unknown;
  };
}
