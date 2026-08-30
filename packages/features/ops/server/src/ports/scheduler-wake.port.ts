/** Wakes the scheduler loop after an operator makes work due. */
export abstract class SchedulerWakeService {
  abstract wake(): void;
}

export class NoopSchedulerWakeService extends SchedulerWakeService {
  private constructor() {
    super();
  }

  static create(): NoopSchedulerWakeService {
    return new NoopSchedulerWakeService();
  }

  wake(): void {}
}
