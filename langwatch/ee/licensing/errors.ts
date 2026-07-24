/**
 * Custom error types for licensing domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

export class OrganizationNotFoundError extends Error {
  constructor(message = "Organization not found") {
    super(message);
    this.name = "OrganizationNotFoundError";
  }
}
