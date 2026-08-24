import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class SuiteNotFoundError extends NotFoundError {
  declare readonly code: "suite_not_found";

  constructor(id: string) {
    super("suite_not_found", "Suite", id);
    this.name = "SuiteNotFoundError";
  }
}

export class SuiteNameTakenError extends HandledError {
  declare readonly code: "suite_name_taken";

  constructor(name: string) {
    super("suite_name_taken", `A suite named "${name}" already exists.`, {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "SuiteNameTakenError";
  }
}
