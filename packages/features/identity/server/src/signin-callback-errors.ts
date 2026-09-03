import { HandledError } from "@langwatch/handled-error";

/**
 * The two refusals an SSO callback can end in (ADR-117 §3). Handled, because
 * both have a known cause and an action the person can take: wait for an
 * administrator to confirm the link, or ask to be invited.
 *
 * The codes carry the `identity_` prefix every other identity refusal uses,
 * and each one mirrors a routing reason code (`link_proposed`, `jit_disabled`)
 * — the vocabulary the decisions and the screens share. Codes are vocabulary;
 * the words a customer reads live in the app's presentation registry.
 *
 * Neither message names the person, the address, or whether an account exists.
 * A callback refusal is answered to whoever arrived, and the arriving party is
 * not necessarily the owner of the address the IdP asserted.
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
