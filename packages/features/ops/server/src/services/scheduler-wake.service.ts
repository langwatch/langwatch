import { SchedulerWakePort } from "../ports/scheduler-wake.port.ts";

export class NoopSchedulerWakeService extends SchedulerWakePort {
  private constructor() {
    super();
  }

  static create(): NoopSchedulerWakeService {
    return new NoopSchedulerWakeService();
  }

  wake(): void {}
}
