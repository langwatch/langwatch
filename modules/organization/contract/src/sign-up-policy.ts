/**
 * Who may create an account on this installation, and who may found an
 * organization once they have one (specs/auth/sign-up-restriction.feature).
 */

/** `open` admits anybody who reaches the installation; `invite_only` admits invited addresses. */
export type SignUpMode = "open" | "invite_only";

export type SignUpVerdict =
  | {
      allowed: true;
      via: "open" | "instance_admin" | "invitation" | "first_account";
    }
  | { allowed: false; reason: "invite_only" | "domain_not_allowed" };

export type OrganizationCreationVerdict =
  | { allowed: true; via: "open" | "instance_admin" | "first_organization" }
  | { allowed: false; reason: "invite_only" };
