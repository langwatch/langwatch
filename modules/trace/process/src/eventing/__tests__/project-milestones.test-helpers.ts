import type { ProjectMetadataSubscriberDeps } from "../project-metadata.subscriber.ts";
import type {
  RecordFirstTraceCommandData,
  RecordTraceReceivedCommandData,
} from "../trace-project-milestones.events.ts";

/** A recorded milestone, named by the command that recorded it, for one assertion surface. */
export type RecordedMilestone =
  | ({ recorded: "firstTrace" } & RecordFirstTraceCommandData)
  | ({ recorded: "traceReceived" } & RecordTraceReceivedCommandData);

/** The subscriber's milestone senders, each forwarding what it was sent to one recorder. */
export function milestonesOver(
  record: (milestone: RecordedMilestone) => Promise<void>,
): ProjectMetadataSubscriberDeps["milestones"] {
  return {
    recordFirstTrace: (data) => record({ recorded: "firstTrace", ...data }),
    recordTraceReceived: (data) => record({ recorded: "traceReceived", ...data }),
  };
}
