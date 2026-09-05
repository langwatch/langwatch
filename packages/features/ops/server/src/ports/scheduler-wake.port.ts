/** Wakes the scheduler loop after an operator makes work due. */
export abstract class SchedulerWakePort {
  abstract wake(): void;
}

