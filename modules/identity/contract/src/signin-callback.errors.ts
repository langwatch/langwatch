import { HandledError } from "@langwatch/handled-error";

/** SSO callback refusals: link_proposed (admin must confirm) or jit_disabled. Handled because the
 * person has an action to take. See ADR-117 §3.
 */
export class IdentityLinkProposedError extends HandledError {
  declare readonly code: "identity_link_proposed";

  constructor() {
    super("identity_link_proposed", "identity_link_proposed", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "IdentityLinkProposedError";
  }
}

export class IdentityJitDisabledError extends HandledError {
  declare readonly code: "identity_jit_disabled";

  constructor() {
    super("identity_jit_disabled", "identity_jit_disabled", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "IdentityJitDisabledError";
  }
}
