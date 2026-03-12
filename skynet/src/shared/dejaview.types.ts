export interface DejaViewEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  timestamp: number;
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
  aggregateType: string;
  eventCount: number;
}

export interface ReplayResponse {
  events: DejaViewEvent[];
  projections: ProjectionMeta[];
  handlers: HandlerMeta[];
  pipelineAggregateTypes: Record<string, string>;
  childAggregateIds?: string[];
}

export interface ProjectionStateResponse {
  projectionId: string;
  cursor: number;
  state: ProjectionStateSnapshot[];
}
