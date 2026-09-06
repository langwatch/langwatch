import type { CredentialClass } from "./access-policy";

/** An OpenAPI security requirement: scheme name to the scopes it needs. */
export type SecurityRequirement = Record<string, never[]>;

/**
 * The fixed set of Path Item members that are operations, per OpenAPI 3.1.
 *
 * A Path Item also holds `servers`, `parameters`, `summary`, `description` and
 * `$ref`, and the first two are arrays, which are objects to `typeof`. Walking
 * a path item by value shape therefore mistakes them for operations, and
 * stamping `security` onto `servers` produces a document that no longer
 * validates. Nothing in the document carries those members today, which is
 * exactly why this has to be a rule rather than an observation.
 */
const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

/** Whether a Path Item member names an operation rather than path metadata. */
export function isHttpMethod(member: string): boolean {
  return HTTP_METHODS.has(member.toLowerCase());
}

/**
 * A registered route's path, spelled the way the OpenAPI document spells it.
 *
 * Hono writes a parameter as `:id` where the document writes `{id}`, and Hono
 * may additionally pin the parameter to a pattern in braces — `/:id{.+}`,
 * `/:id{.+?}`, `/:version{v[0-9]+}`. That pattern belongs to the matcher, not
 * to the parameter's name, so it comes off here. Carrying it through produced
 * `/api/prompts/{id}{.+}`, which matches no documented path, and every
 * operation spelled that way kept the document-wide security default instead
 * of the credential class its route enforces.
 *
 * The inner alternation allows one level of nesting so a quantifier inside the
 * pattern (`{[0-9]{3}}`) is consumed whole rather than ending the match early.
 */
export function documentedPathOf(honoPath: string): string {
  return honoPath.replace(
    /:([A-Za-z0-9_]+)(\{(?:[^{}]|\{[^{}]*\})*\})?/g,
    "{$1}",
  );
}

/**
 * Which security schemes the published document offers for each credential
 * class.
 *
 * Only the classes an API consumer can actually present appear here, and the
 * omission is the point: an empty requirement list is not OpenAPI for "you
 * cannot call this", it is OpenAPI for "no credential is required". That is
 * true of a public route and false of a session-only or internal one, so those
 * two have no entry and are refused instead of published as unauthenticated.
 */
const SECURITY_BY_CREDENTIAL_CLASS = {
  project_api_key: [{ project_api_key: [] }],
  organization_api_key: [{ admin_api_key: [] }],
  instance_admin_api_key: [{ instance_admin_key: [] }],
  scim_token: [{ scim_bearer: [] }],
  none: [],
} as const satisfies Record<
  Exclude<CredentialClass, "session" | "internal">,
  readonly SecurityRequirement[]
>;

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
}): readonly SecurityRequirement[] {
  if (credentialClass === "session" || credentialClass === "internal") {
    throw new Error(
      `${operationKey} is documented in the public API description but reaches by "${credentialClass}", ` +
        "which has no security scheme an API client can satisfy. Either give the document a scheme " +
        "for it, or drop the describeRoute() so it stops being advertised.",
    );
  }
  return SECURITY_BY_CREDENTIAL_CLASS[credentialClass];
}
