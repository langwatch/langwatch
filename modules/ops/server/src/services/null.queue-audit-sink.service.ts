import { QueueAuditSink } from "../app/ops.app.ts";

/** For app presets that run without Postgres. */
export class NullQueueAuditSink extends QueueAuditSink {
  private constructor() {
    super();
  }

  static create(): NullQueueAuditSink {
    return new NullQueueAuditSink();
  }

  async append(): Promise<void> {}
}
