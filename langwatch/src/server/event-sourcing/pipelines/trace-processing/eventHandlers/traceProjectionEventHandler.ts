import { generate } from "@langwatch/ksuid";

import type { EventStream, Event } from "../../../library";
import { createTenantId } from "../../../library";
import type { EventHandler } from "./eventHandler";
import type { TraceProjection } from "../types";
import type { SpanData } from "../../span-processing/types";
import { buildTraceProjection } from "../services/traceProjectionService";
import type { SpanReadRepository } from "../repositories/spanReadRepositoryClickHouse";

export class TraceProjectionEventHandler implements EventHandler {
  constructor(private readonly spanReadRepository: SpanReadRepository) {}

  async handle(
    stream: EventStream<string, Event<string, unknown>>,
  ): Promise<TraceProjection> {
    const aggregateId = stream.getAggregateId();

    const firstEvent = stream.getEvents()[0];
    if (!firstEvent) {
      throw new Error("Event stream is empty");
    }

    const tenantId = firstEvent.tenantId;
    if (!tenantId) {
      throw new Error("Event has no tenantId");
    }

    const tenantIdString = String(tenantId);
    const spans: SpanData[] = await this.spanReadRepository.getSpansForTrace(
      tenantIdString,
      aggregateId,
    );

    const projectionData = buildTraceProjection(
      tenantIdString,
      aggregateId,
      spans,
    );

    return {
      id: generate("projection").toString(),
      aggregateId,
      tenantId: createTenantId(tenantIdString),
      version: Date.now(),
      data: projectionData,
    };
  }
}
