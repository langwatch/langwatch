import { generate } from "@langwatch/ksuid";

import type { EventStream, Event } from "../../../library";
import type { EventHandler } from "./eventHandler";
import type { TraceProjection } from "../types";
import type { SpanData } from "../../span-processing/types";
import { buildTraceProjection } from "../utils/buildTraceProjection";
import type { SpanReadRepository } from "../repositories/spanReadRepositoryClickHouse";

export class TraceProjectionEventHandler implements EventHandler {
  constructor(private readonly spanReadRepository: SpanReadRepository) {}

  async handle(stream: EventStream<string, Event<string, unknown>>): Promise<TraceProjection> {
    const aggregateId = stream.getAggregateId();

    const firstEvent = stream.getEvents()[0] as
      | { metadata?: { tenantId?: string } }
      | undefined;

    const tenantId = firstEvent?.metadata?.tenantId ?? "";

    const spans: SpanData[] = await this.spanReadRepository.getSpansForTrace(
      tenantId,
      aggregateId,
    );

    const projectionData = buildTraceProjection(tenantId, aggregateId, spans);

    return {
      id: generate("projection").toString(),
      aggregateId,
      version: Date.now(),
      data: projectionData,
    };
  }
}
