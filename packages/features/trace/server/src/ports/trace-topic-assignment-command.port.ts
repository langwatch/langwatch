import type { AssignTopicCommandData } from "@langwatch/trace-contract";

/** Process-composed sender for Trace's registered durable topic command. */
export abstract class TraceTopicAssignmentCommandPort {
  abstract sendAssignTopic(input: AssignTopicCommandData): Promise<void>;
}
