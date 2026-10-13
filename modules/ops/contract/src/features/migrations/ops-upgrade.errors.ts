import { HandledError } from "@langwatch/handled-error";

/** Retry reopens only a failed background step (Alex, 2026-10-09, UPGRADE-CONSOLE D6). */
export class UpgradeStepNotFailedError extends HandledError {
  declare readonly code: "upgrade_step_not_failed";

  constructor({ stepId, status }: { stepId: string; status: string }) {
    super("upgrade_step_not_failed", `Upgrade step "${stepId}" is ${status}, not failed.`, {
      httpStatus: 409,
      fault: "customer",
      meta: { stepId, status },
    });
    this.name = "UpgradeStepNotFailedError";
  }
}
