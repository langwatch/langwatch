import { HandledError } from "@langwatch/handled-error";

import { remediation } from "../../app-layer/error-remediation";

/**
 * A custom role with this name already exists in the organization.
 *
 * Handled (409) on the natural key: role names are how Terraform-shaped
 * callers address roles, and a deterministic conflict code beats parsing the
 * sentence.
 */
export class RoleDuplicateNameError extends HandledError {
  declare readonly code: "custom_role_name_taken";

  constructor(message = "A role with this name already exists") {
    super("custom_role_name_taken", message, {
      httpStatus: 409,
      ...remediation("custom_role_name_taken"),
    });
    this.name = "RoleDuplicateNameError";
  }
}
