import type { AssignTopicCommandData } from "./trace-processing.commands";

/**
 * Trace owns the durable assignment command that materialises a clustered
 * topic on its trace projections. Other features use this portable command
 * port rather than reaching into Trace's Eventing pipeline.
 */
export abstract class TraceTopicAssignmentPort {
  abstract assignTopic(input: AssignTopicCommandData): Promise<void>;
}
