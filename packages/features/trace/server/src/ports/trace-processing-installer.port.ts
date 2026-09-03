import type { EventSourcing } from "@langwatch/eventing";
import type { RecordSpanCommandData, TraceTopicAssignmentPort } from "@langwatch/trace-contract";

/** Worker-facing installation capability for Trace's complete processing graph. */
export abstract class TraceProcessingInstallerPort {
  abstract install(eventSourcing: EventSourcing): {
    traceAssignments: TraceTopicAssignmentPort;
    /**
     * The registered `recordSpan` command, named because two of Trace's own
     * paths reach the pipeline through the queue rather than through the fold:
     * the REST tracked-event handler and the `trackedEventSync` reactor both
     * mint a synthetic span and have to send it the way an SDK export would.
     *
     * It is available only AFTER registration, which is why the process that
     * needs it hands the subscriber a late-bound proxy rather than the command.
     */
    commands: { recordSpan: (data: RecordSpanCommandData) => Promise<unknown> };
  };
}
