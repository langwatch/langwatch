import type { CredentialClass } from "./access-policy";

/** An OpenAPI security requirement: scheme name to the scopes it needs. */
export type SecurityRequirement = Record<string, never[]>;

/**
 * Which security schemes the published document offers for each credential
 * class.
 *
 * Only the two API-key families and `none` appear, and the omission is the
 * point: an empty requirement list is not OpenAPI for "you cannot call this",
 * it is OpenAPI for "no credential is required". That is true of a public
 * route and false of a session-only or internal one, so those two have no
 * entry and are refused instead of published as unauthenticated.
 */
const SECURITY_BY_CREDENTIAL_CLASS: Record<
  Exclude<CredentialClass, "session" | "internal">,
  SecurityRequirement[]
> = {
  project_api_key: [{ project_api_key: [] }],
  organization_api_key: [{ admin_api_key: [] }],
  none: [],
};

/**
 * The security requirement a documented operation publishes, given the
 * credential class its route enforces.
 *
 * Throws when the class is one an API client cannot present. A session cookie
 * and an internal shared secret are both real credentials, and neither has a
 * scheme in this document because neither is something a consumer of the
 * public API holds. The only honest options for such an operation are to give
 * the document a scheme for it or to keep it out of the document; writing an
 * empty requirement is the dishonest third, because every generated client
 * would then emit an unauthenticated call. That is the same defect
 * per-operation stamping exists to fix, one class further along, so it fails
 * the generator rather than shipping.
 *
 * @param operationKey `"GET /api/gateway/v1/budgets"`, for the message.
 */
export function securityForCredentialClass({
  operationKey,
  credentialClass,
}: {
  operationKey: string;
  credentialClass: CredentialClass;
}): SecurityRequirement[] {
  if (credentialClass === "session" || credentialClass === "internal") {
    throw new Error(
      `${operationKey} is documented in the public API description but reaches by "${credentialClass}", ` +
        "which has no security scheme an API client can satisfy. Either give the document a scheme " +
        "for it, or drop the describeRoute() so it stops being advertised.",
    );
  }
  return SECURITY_BY_CREDENTIAL_CLASS[credentialClass];
}
