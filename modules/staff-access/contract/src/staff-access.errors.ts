/**
 * Every refusal the staff access flow raises (ADR-193). A surface that is off, a request that is
 * not the caller's, and an unknown id all answer the same `not_found`, so none discloses anything.
 * The gate's refusals (revoked, expired, address, operator, spend) are `@langwatch/api`'s.
 */
import { HandledError, remediation } from "@langwatch/handled-error";

/** Hidden: the feature is off, the request is someone else's, or there is no such request. */
export class StaffAccessNotFoundError extends HandledError {
  declare readonly code: "not_found";

  constructor() {
    super("not_found", "Not found.", { httpStatus: 404, fault: "customer" });
    this.name = "StaffAccessNotFoundError";
  }
}

/** The bearer is no live requester key or ops token. */
export class StaffAccessCredentialRefusedError extends HandledError {
  declare readonly code: "invalid_credentials";

  constructor() {
    super("invalid_credentials", "This staff access credential is not valid.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "StaffAccessCredentialRefusedError";
  }
}

export class StaffAccessPasskeyRequiredError extends HandledError {
  declare readonly code: "passkey_required";

  constructor() {
    super("passkey_required", "Add a passkey to your account before enrolling an agent.", {
      httpStatus: 403,
      fault: "customer",
      ...remediation("passkey_required"),
    });
    this.name = "StaffAccessPasskeyRequiredError";
  }
}

export class StaffAccessOrganizationNameMismatchError extends HandledError {
  declare readonly code: "organization_name_mismatch";

  constructor() {
    super("organization_name_mismatch", "Type the organization's name exactly to approve.", {
      httpStatus: 400,
      fault: "customer",
      ...remediation("organization_name_mismatch"),
    });
    this.name = "StaffAccessOrganizationNameMismatchError";
  }
}

export class StaffAccessRequestExpiredError extends HandledError {
  declare readonly code: "request_expired";

  constructor() {
    super("request_expired", "This access request expired. Ask the agent to request again.", {
      httpStatus: 410,
      fault: "customer",
      ...remediation("request_expired"),
    });
    this.name = "StaffAccessRequestExpiredError";
  }
}

export class StaffAccessRequestNotPendingError extends HandledError {
  declare readonly code: "request_not_pending";

  constructor() {
    super("request_not_pending", "This access request was already decided.", {
      httpStatus: 409,
      fault: "customer",
      ...remediation("request_not_pending"),
    });
    this.name = "StaffAccessRequestNotPendingError";
  }
}

export class StaffAccessRequestNotApprovedError extends HandledError {
  declare readonly code: "request_not_approved";

  constructor() {
    super("request_not_approved", "This access request was not approved.", {
      httpStatus: 409,
      fault: "customer",
      ...remediation("request_not_approved"),
    });
    this.name = "StaffAccessRequestNotApprovedError";
  }
}

export class StaffAccessInvalidCodeVerifierError extends HandledError {
  declare readonly code: "invalid_code_verifier";

  constructor() {
    super("invalid_code_verifier", "The code verifier does not match this request.", {
      httpStatus: 400,
      fault: "customer",
      ...remediation("invalid_code_verifier"),
    });
    this.name = "StaffAccessInvalidCodeVerifierError";
  }
}

export class StaffAccessAlreadyRedeemedError extends HandledError {
  declare readonly code: "already_redeemed";

  constructor() {
    super("already_redeemed", "This access request was already redeemed.", {
      httpStatus: 409,
      fault: "customer",
      ...remediation("already_redeemed"),
    });
    this.name = "StaffAccessAlreadyRedeemedError";
  }
}

export class StaffAccessRateLimitedError extends HandledError {
  declare readonly code: "staff_access_rate_limited";

  constructor({ retryAfterMs }: { retryAfterMs: number }) {
    super("staff_access_rate_limited", "This agent made too many requests in the last hour.", {
      httpStatus: 429,
      fault: "customer",
      retryable: true,
      meta: { retryAfterMs },
      ...remediation("staff_access_rate_limited"),
    });
    this.name = "StaffAccessRateLimitedError";
  }
}

export class StaffAccessConfirmationMismatchError extends HandledError {
  declare readonly code: "staff_access_confirmation_mismatch";

  constructor() {
    super("staff_access_confirmation_mismatch", 'Type "revoke all" to revoke every session.', {
      httpStatus: 400,
      fault: "customer",
      ...remediation("staff_access_confirmation_mismatch"),
    });
    this.name = "StaffAccessConfirmationMismatchError";
  }
}

export class StaffAccessAlreadyEndedError extends HandledError {
  declare readonly code: "staff_access_already_ended";

  constructor() {
    super("staff_access_already_ended", "This staff access session already ended.", {
      httpStatus: 409,
      fault: "customer",
      ...remediation("staff_access_already_ended"),
    });
    this.name = "StaffAccessAlreadyEndedError";
  }
}

export class StaffAccessNotConfiguredError extends HandledError {
  declare readonly code: "staff_access_not_configured";

  constructor() {
    super(
      "staff_access_not_configured",
      "Staff access needs the public base URL to build its approval link.",
      { httpStatus: 503, fault: "platform", ...remediation("staff_access_not_configured") },
    );
    this.name = "StaffAccessNotConfiguredError";
  }
}

/** The source ops token of an organization copy is no session this server issued. */
export class StaffCopySourceInvalidError extends HandledError {
  declare readonly code: "staff_copy_source_invalid";

  constructor() {
    super("staff_copy_source_invalid", "The source session of this copy is not valid.", {
      httpStatus: 401,
      fault: "customer",
      ...remediation("staff_copy_source_invalid"),
    });
    this.name = "StaffCopySourceInvalidError";
  }
}

/** One side of a copy lacks its scopes: `ops:copy` with `org:content` or with `org:support`. */
export class StaffCopyScopeMissingError extends HandledError {
  declare readonly code: "staff_copy_scope_missing";

  constructor({ side }: { side: "source" | "target" }) {
    super(
      "staff_copy_scope_missing",
      side === "source"
        ? "The source session was not approved for ops:copy with org:content."
        : "The target session was not approved for ops:copy with org:support.",
      { httpStatus: 403, fault: "customer", ...remediation("staff_copy_scope_missing") },
    );
    this.name = "StaffCopyScopeMissingError";
  }
}

export class StaffCopySameOrganizationError extends HandledError {
  declare readonly code: "staff_copy_same_organization";

  constructor() {
    super("staff_copy_same_organization", "The source and target are the same organization.", {
      httpStatus: 400,
      fault: "customer",
      ...remediation("staff_copy_same_organization"),
    });
    this.name = "StaffCopySameOrganizationError";
  }
}

/** The two approvals belong to different agents or operators. */
export class StaffCopyApprovalsMismatchError extends HandledError {
  declare readonly code: "staff_copy_approvals_mismatch";

  constructor() {
    super(
      "staff_copy_approvals_mismatch",
      "Both approvals of a copy must come from the same agent and operator.",
      { httpStatus: 403, fault: "customer", ...remediation("staff_copy_approvals_mismatch") },
    );
    this.name = "StaffCopyApprovalsMismatchError";
  }
}

/** The source approval is not live in the target's window: expired, ended or revoked. */
export class StaffCopyWindowClosedError extends HandledError {
  declare readonly code: "staff_copy_window_closed";

  constructor() {
    super(
      "staff_copy_window_closed",
      "The source approval is no longer live; both approvals must be live at once.",
      { httpStatus: 403, fault: "customer", ...remediation("staff_copy_window_closed") },
    );
    this.name = "StaffCopyWindowClosedError";
  }
}
