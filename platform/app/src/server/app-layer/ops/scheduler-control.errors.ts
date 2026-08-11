import { HandledError } from "@langwatch/handled-error";

/**
 * Refusals an operator can act on (ADR-091).
 *
 * Each names a cause the caller can do something about, so each gets a stable
 * code and copy in the client presentation registry. Anything else — a dead
 * Postgres, a bug — stays a plain Error and degrades to "unknown" with a trace
 * id, which is the honest answer for a failure we cannot name.
 */

export class ScheduleNotFoundError extends HandledError {
  declare readonly code: "schedule_not_found";

  constructor(scheduleId: string) {
    super("schedule_not_found", "That schedule no longer exists.", {
      httpStatus: 404,
      meta: { schedule_id: scheduleId },
      fault: "customer",
    });
    this.name = "ScheduleNotFoundError";
  }
}

export class ScheduleInactiveError extends HandledError {
  declare readonly code: "schedule_inactive";

  constructor(scheduleId: string) {
    super(
      "schedule_inactive",
      "That schedule is paused, so it will not be run.",
      {
        httpStatus: 409,
        meta: { schedule_id: scheduleId },
        fault: "customer",
      },
    );
    this.name = "ScheduleInactiveError";
  }
}

/**
 * The fencing token moved: the loop claimed or advanced the row between the
 * operator reading it and acting on it. Nothing was changed.
 */
export class ScheduleAlreadyInFlightError extends HandledError {
  declare readonly code: "schedule_already_in_flight";

  constructor(scheduleId: string) {
    super(
      "schedule_already_in_flight",
      "The scheduler changed this slot first, so nothing was changed.",
      {
        httpStatus: 409,
        meta: { schedule_id: scheduleId },
        fault: "customer",
      },
    );
    this.name = "ScheduleAlreadyInFlightError";
  }
}

export class ScheduleSlotNotStaleError extends HandledError {
  declare readonly code: "schedule_slot_not_stale";

  constructor(scheduleId: string) {
    super(
      "schedule_slot_not_stale",
      "That slot is still current, so it was not cleared.",
      {
        httpStatus: 409,
        meta: { schedule_id: scheduleId },
        fault: "customer",
      },
    );
    this.name = "ScheduleSlotNotStaleError";
  }
}
