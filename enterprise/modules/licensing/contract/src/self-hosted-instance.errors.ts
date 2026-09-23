// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HandledError } from "@langwatch/handled-error";

/** The registry has never heard from an install with that id. */
export class SelfHostedInstanceNotFoundError extends HandledError {
  declare readonly code: "self_hosted_instance_not_found";

  constructor() {
    super("self_hosted_instance_not_found", "No self-hosted install with that id has reported", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "SelfHostedInstanceNotFoundError";
  }
}
