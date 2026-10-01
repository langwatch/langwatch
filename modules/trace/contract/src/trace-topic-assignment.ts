import type { AssignTopicCommandData } from "./trace-processing.commands.ts";

/**
 * Trace owns the durable assignment command that materialises a clustered
 * topic on its trace projections. Other features use this portable command
 * port rather than reaching into Trace's Eventing pipeline.
 */
export abstract class TraceTopicAssignment {
  abstract assignTopic(input: AssignTopicCommandData): Promise<void>;
}
