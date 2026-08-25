/**
 * A sentence for a failure the API named but did not write prose for.
 *
 * The REST error envelope sends `message` equal to `code` on purpose: a
 * handled error's message is server copy, and the framework will not forward
 * it to an external caller. That leaves the code as the only thing describing
 * what happened, and printing it verbatim gives the user a line like
 * "Failed to fetch the organization: enterprise_plan_required".
 *
 * So the client renders its own copy, keyed on the code, the same way the web
 * app does. Two layers, in order:
 *
 *   1. `SENTENCE_BY_CODE`, for codes whose slug reads wrong on its own or
 *      leaves out the one fact the reader needs.
 *   2. Otherwise the slug, humanized. `organization_slug_taken` becomes
 *      "Organization slug taken", which is plain and never misleading, so an
 *      unlisted code degrades into something readable rather than into
 *      punctuation.
 *
 * What to DO about a failure lives in the CLI's `errorSuggestions.ts`; this is
 * only what happened. Keys are exact codes, never prefixes: a new code that
 * lands nowhere gets humanized, not filed under a neighbour.
 */

const SENTENCE_BY_CODE: Record<string, string> = {
  enterprise_plan_required: "This capability needs the Enterprise plan",
  insufficient_permissions:
    "This credential does not carry the permission this call needs",
  missing_credentials: "This request carried no API key",
  invalid_credentials: "That API key is not valid",
  organization_not_found:
    "That API key does not resolve to an organization on this instance",
  validation_error: "The request did not pass validation",
  custom_role_in_use: "That role is still held by a member or a role binding",
  custom_role_id_required:
    "A CUSTOM role binding has to name which custom role it grants",
  custom_role_not_assignable: "That custom role cannot be granted here",
  custom_role_name_reserved: "That role name is reserved",
  custom_role_name_taken: "A role with that name already exists here",
  role_binding_principal_invalid:
    "A role binding names exactly one principal: a user, a group, or an API key",
  role_binding_already_exists: "That principal already holds that role at that scope",
  org_exclusive_permission_scope:
    "That role carries an organization-only permission, so it cannot be bound to a team or a project",
  member_seat_limit_reached: "The plan's member seats are all in use",
  personal_workspace_not_managed_here:
    "Personal workspaces are not managed through this API",
  already_organization_member: "They are already in this organization",
  user_not_in_organization: "That user is not a member of this organization",
  group_not_in_organization: "That group does not belong to this organization",
  api_key_not_in_organization: "That API key does not belong to this organization",
  team_not_in_organization: "That team does not belong to this organization",
  scope_not_in_organization: "That scope does not belong to this organization",
  // Humanizing turns an acronym into a word: "Api key not found", "Scim token
  // not found". Spelled out here instead.
  api_key_not_found: "API key not found",
  api_key_not_owned: "That API key belongs to somebody else",
  api_key_already_revoked: "That API key is already revoked",
  scim_token_not_found: "SCIM token not found",
  duplicate_invite: "They already have a pending invite",
  cannot_remove_self: "A credential cannot remove its own member",
  cannot_disable_self: "A credential cannot disable its own member",
  cannot_remove_last_admin:
    "That is the organization's last administrator, so it has to keep them",
  api_key_scope_violation: "That API key cannot be given that access",
};

/** `organization_slug_taken` -> `Organization slug taken`. */
const humanizeCode = (code: string): string => {
  const words = code.replace(/[_-]+/g, " ").trim();
  if (!words) return code;
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * True when the body's `message` says nothing the `code` did not: the envelope
 * forwarded the code, so there is no server prose to prefer over our copy.
 */
export const isCodeAsMessage = ({
  code,
  message,
}: {
  code: unknown;
  message: unknown;
}): boolean =>
  typeof code === "string" &&
  code.length > 0 &&
  typeof message === "string" &&
  message.trim() === code;

/** The sentence to show for a code the API named. */
export const sentenceForCode = (code: string): string =>
  SENTENCE_BY_CODE[code] ?? humanizeCode(code);

/**
 * True for a value shaped like one of our error codes: lower case throughout,
 * words joined by underscores. That is what separates `invalid_credentials`
 * and `unauthorized` from the reason phrases, class names and free text that
 * share the same envelope fields ("Conflict", "NotFoundError", "UNEXPECTED",
 * "connection refused"), which are prose, and prose is not a code.
 */
export const looksLikeErrorCode = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value);
