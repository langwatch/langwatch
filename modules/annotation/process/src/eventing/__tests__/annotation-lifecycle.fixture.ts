import { createTenantId } from "@langwatch/eventing";

import type { AnnotationLifecycleSenders } from "../../services/annotation-facts.service.ts";
import {
  type AnnotationLifecycleEvent,
  RecordAnnotationCreatedCommand,
  RecordAnnotationDeletedCommand,
  RecordAnnotationUpdatedCommand,
  RecordScoreDefinedCommand,
  RecordScoreRenamedCommand,
} from "../annotation-lifecycle.commands.ts";

type Handler<Data> = {
  handle(command: {
    tenantId: ReturnType<typeof createTenantId>;
    aggregateId: string;
    type: string;
    data: Data;
  }): AnnotationLifecycleEvent[];
};

/**
 * The pipeline's senders over its real command handlers and an event log that keeps the first
 * event per idempotency key, as the event store does; `sent` counts every send.
 */
export function recordingLifecycleSenders(): {
  senders: AnnotationLifecycleSenders;
  events: () => AnnotationLifecycleEvent[];
  sent: () => number;
} {
  const log = new Map<string, AnnotationLifecycleEvent>();
  let sent = 0;
  const sender = <Data extends { tenantId: string }>(
    handler: Handler<Data>,
    aggregateIdOf: (data: Data) => string,
  ) => ({
    send: async (data: Data) => {
      sent += 1;
      const events = handler.handle({
        tenantId: createTenantId(data.tenantId),
        aggregateId: aggregateIdOf(data),
        type: "record",
        data,
      });
      for (const event of events) {
        const key = event.idempotencyKey ?? event.id;
        if (!log.has(key)) log.set(key, event);
      }
    },
  });
  return {
    senders: {
      recordAnnotationCreated: sender(new RecordAnnotationCreatedCommand(), (data) =>
        RecordAnnotationCreatedCommand.getAggregateId(data),
      ),
      recordAnnotationUpdated: sender(new RecordAnnotationUpdatedCommand(), (data) =>
        RecordAnnotationUpdatedCommand.getAggregateId(data),
      ),
      recordAnnotationDeleted: sender(new RecordAnnotationDeletedCommand(), (data) =>
        RecordAnnotationDeletedCommand.getAggregateId(data),
      ),
      recordScoreDefined: sender(new RecordScoreDefinedCommand(), (data) =>
        RecordScoreDefinedCommand.getAggregateId(data),
      ),
      recordScoreRenamed: sender(new RecordScoreRenamedCommand(), (data) =>
        RecordScoreRenamedCommand.getAggregateId(data),
      ),
    },
    events: () => [...log.values()],
    sent: () => sent,
  };
}
