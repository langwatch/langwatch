export interface DejaViewEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  timestamp: number;
  createdAt: string;
  type: string;
  data: unknown;
  metadata?: {
    processingTraceparent?: string;
    [key: string]: unknown;
  };
}

export interface ProjectionMeta {
  id: string;
  pipelineName: string;
  projectionName: string;
  eventTypes: string[];
  aggregateType?: string;
}

export interface HandlerMeta {
  id: string;
  pipelineName: string;
  handlerName: string;
  eventTypes: string[];
}

export interface ProjectionStateSnapshot {
  aggregateId: string;
  tenantId: string;
  data: unknown;
}

export interface AggregateInfo {
  aggregateId: string;
  tenantId: string;
  aggregateType: string;
  eventCount: number;
}

export interface ReplayResponse {
  events: DejaViewEvent[];
  projections: ProjectionMeta[];
  handlers: HandlerMeta[];
  pipelineAggregateTypes: Record<string, string>;
  childAggregateIds?: string[];
  totalEventCount: number;
  truncated: boolean;
}

export interface ProjectionStateResponse {
  projectionId: string;
  cursor: number;
  state: ProjectionStateSnapshot[];
}

export interface ProjectionSnapshot {
  aggregateId: string;
  tenantId: string;
  version?: string;
  data: unknown;
}

export interface ProjectionStep {
  eventIndex: number;
  eventId: string;
  eventType: string;
  stale: boolean;
  projectionStateByAggregate: ProjectionSnapshot[];
}

export interface ProjectionTimeline {
  projection: { id: string; pipelineName: string; projectionName: string };
  steps: ProjectionStep[];
}

export interface EventHandlerStep {
  eventIndex: number;
  eventId: string;
  eventType: string;
  processed: boolean;
  displayData?: unknown;
}

export interface EventHandlerTimeline {
  handler: { id: string; pipelineName: string; handlerName: string; eventTypes?: readonly string[] };
  steps: EventHandlerStep[];
}
