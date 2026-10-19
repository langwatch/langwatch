import { extractEmailDomain } from "@langwatch/auth-contract";

/** The address domain LangWatch staff hold; on the hosted cloud only they operate. */
export const PLATFORM_OPERATOR_STAFF_DOMAIN = "langwatch.ai";

/** Whether an account is LangWatch staff: a verified address on the staff domain, exactly. */
export function isStaffAccount({
  email,
  emailVerified,
}: {
  email: string | null;
  emailVerified: boolean;
}): boolean {
  return emailVerified && extractEmailDomain(email) === PLATFORM_OPERATOR_STAFF_DOMAIN;
}

/**
 * Whether grants are kept to staff: on a deployment LangWatch runs (the operator seed's own
 * `cloud`), except a developer's local stack, which seeds its own admin as `decideCloudOps` does.
 */
export function grantsAreStaffOnly({
  cloud,
  isLocalDevelopment,
}: {
  cloud: boolean;
  isLocalDevelopment: boolean;
}): boolean {
  return cloud && !isLocalDevelopment;
}
