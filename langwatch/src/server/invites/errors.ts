/**
 * Custom error types for invite domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

export class DuplicateInviteError extends Error {
  constructor(email: string) {
    super(`An active invitation for ${email} already exists`);
    this.name = "DuplicateInviteError";
  }
}

export class InviteNotFoundError extends Error {
  constructor(
    message = "Invitation not found or is not waiting for approval"
  ) {
    super(message);
    this.name = "InviteNotFoundError";
  }
}

export class LicenseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseLimitError";
  }
}

export class OrganizationNotFoundError extends Error {
  constructor() {
    super("Organization not found");
    this.name = "OrganizationNotFoundError";
  }
}
