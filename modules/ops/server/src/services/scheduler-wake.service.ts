import { SchedulerWakePort } from "../app/ops.app.ts";

export class NoopSchedulerWakeService implements SchedulerWakePort {
  private constructor() {
  }

  static create(): NoopSchedulerWakeService {
    return new NoopSchedulerWakeService();
  }

  wake(): void {}
}
