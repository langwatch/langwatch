import { SchedulerWake } from "../app/ops.app.ts";

export class NoopSchedulerWakeService implements SchedulerWake {
  private constructor() {
  }

  static create(): NoopSchedulerWakeService {
    return new NoopSchedulerWakeService();
  }

  wake(): void {}
}
