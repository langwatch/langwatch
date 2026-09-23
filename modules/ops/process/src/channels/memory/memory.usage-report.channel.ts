import type { UsageReportChannel, UsageReportPostAnswer } from "../usage-report.channel.ts";

/**
 * The report's destination in memory: every post is kept, and a host answers
 * 200 unless a test stated otherwise. `unreachable` makes the next post throw
 * the way a closed port does.
 */
export class MemoryUsageReportChannel implements UsageReportChannel {
  readonly posts: { endpoint: string; body: Record<string, unknown> }[] = [];
  status = 200;
  unreachable = false;

  private constructor() {}

  static create(): MemoryUsageReportChannel {
    return new MemoryUsageReportChannel();
  }

  async post(input: {
    endpoint: string;
    body: Record<string, unknown>;
  }): Promise<UsageReportPostAnswer> {
    if (this.unreachable) throw new Error(`connect ECONNREFUSED ${input.endpoint}`);
    this.posts.push(input);
    return { status: this.status };
  }
}
