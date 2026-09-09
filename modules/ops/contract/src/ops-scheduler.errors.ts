import { HandledError } from "@langwatch/handled-error";

/** Stable operator-action refusals; infrastructure failures remain unhandled. */

export class ScheduleNotFoundError extends HandledError {
  declare readonly code: "schedule_not_found";

  constructor() {
    super("schedule_not_found", "That schedule no longer exists.", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "ScheduleNotFoundError";
  }
}

export class ScheduleInactiveError extends HandledError {
  declare readonly code: "schedule_inactive";

  constructor() {
    super("schedule_inactive", "That schedule is paused, so it will not be run.", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "ScheduleInactiveError";
  }
}

/**
 * The fencing token moved: the loop claimed or advanced the row between the
 * operator reading it and acting on it. Nothing was changed.
 */
export class ScheduleAlreadyInFlightError extends HandledError {
  declare readonly code: "schedule_already_in_flight";

  constructor() {
    super(
      "schedule_already_in_flight",
      "The scheduler changed this slot first, so nothing was changed.",
      {
        httpStatus: 409,
        fault: "customer",
      },
    );
    this.name = "ScheduleAlreadyInFlightError";
  }
}

/**
 * A run is already in flight. Re-arming would hand the SAME slot to a second
 * worker — the double-delivery ADR-091 exists to prevent.
 */
export class ScheduleRunInProgressError extends HandledError {
  declare readonly code: "schedule_run_in_progress";

  constructor() {
    super(
      "schedule_run_in_progress",
      "That schedule is already running, so it was not started again.",
      {
        httpStatus: 409,
        fault: "customer",
      },
    );
    this.name = "ScheduleRunInProgressError";
  }
}

export class ScheduleSlotNotStaleError extends HandledError {
  declare readonly code: "schedule_slot_not_stale";

  constructor() {
    super("schedule_slot_not_stale", "That slot is still current, so it was not cleared.", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "ScheduleSlotNotStaleError";
  }
}
