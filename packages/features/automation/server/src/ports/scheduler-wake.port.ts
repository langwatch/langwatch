export abstract class SchedulerWake {
  abstract publish(): void;
}

export abstract class SchedulerWakePort extends SchedulerWake {}
