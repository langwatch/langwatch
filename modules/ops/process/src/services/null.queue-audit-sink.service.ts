import type { QueueAuditSink } from "../app/ops.app.ts";

/** For app presets that run without Postgres. */
export class NullQueueAuditSinkService implements QueueAuditSink {
  private constructor() {}

  static create(): NullQueueAuditSinkService {
    return new NullQueueAuditSinkService();
  }

  async append(): Promise<void> {}
}
