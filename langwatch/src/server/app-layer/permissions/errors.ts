import { HandledError } from "../handled-error";

export class LiteMemberRestrictedError extends HandledError {
  declare readonly code: "lite_member_restricted";

  constructor(resource: string) {
    super("lite_member_restricted", "This feature is not available for your account", {
      meta: { resource },
      httpStatus: 401,
    });
    this.name = "LiteMemberRestrictedError";
  }
}
