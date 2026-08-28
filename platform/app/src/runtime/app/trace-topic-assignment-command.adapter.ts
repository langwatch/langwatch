import type { AssignTopicCommandData } from "@langwatch/trace-contract";
import { TraceTopicAssignmentCommandPort } from "@langwatch/trace-server";

/** Temporary legacy-app bridge from the registered Trace command to its port. */
export class AppTraceTopicAssignmentCommandAdapter extends TraceTopicAssignmentCommandPort {
  static create(options: {
    command: { send(input: AssignTopicCommandData): Promise<unknown> };
  }): AppTraceTopicAssignmentCommandAdapter {
    return new AppTraceTopicAssignmentCommandAdapter(options.command);
  }

  private constructor(
    private readonly command: { send(input: AssignTopicCommandData): Promise<unknown> },
  ) {
    super();
  }

  async sendAssignTopic(input: AssignTopicCommandData): Promise<void> {
    await this.command.send(input);
  }
}
