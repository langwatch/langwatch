import type { EventSourcing } from "@langwatch/eventing";
import type { TraceTopicAssignmentPort } from "@langwatch/trace-contract";

/** Worker-facing installation capability for Trace's complete processing graph. */
export abstract class TraceProcessingInstallerPort {
  abstract install(eventSourcing: EventSourcing): {
    traceAssignments: TraceTopicAssignmentPort;
  };
}
