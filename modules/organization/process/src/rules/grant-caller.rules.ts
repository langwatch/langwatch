import type { AuthzGrantCaller } from "@langwatch/authz-contract";
import type { OrganizationCaller } from "@langwatch/organization-contract";

/** Whose holdings bound what a call may grant: the key it arrived on, else the person. */
export function grantCallerOf(by: OrganizationCaller): AuthzGrantCaller {
  return by.apiKeyId ? { type: "apiKey", id: by.apiKeyId } : { type: "user", id: by.id };
}
