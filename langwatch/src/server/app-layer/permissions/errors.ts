import { DomainError } from "../domain-error";

export class LiteMemberRestrictedError extends DomainError {
  declare readonly kind: "lite_member_restricted";

  constructor(resource: string) {
    super("lite_member_restricted", "This feature is not available for your account", {
      meta: { resource },
      httpStatus: 401,
    });
    this.name = "LiteMemberRestrictedError";
  }
}
