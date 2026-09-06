import type { CredentialClass } from "../../access-policy.ts";

/** An OpenAPI security requirement: scheme name to the scopes it needs. */
export type SecurityRequirement = Record<string, never[]>;

/**
 * The fixed set of Path Item members that are operations, per OpenAPI 3.1.
 * A Path Item also holds `servers`, `parameters`, `summary`, `description`
 * and `$ref` — the first two are arrays, which are objects to `typeof` —
 * so walking by value shape mistakes them for operations and stamps
 * `security` onto `servers`, producing a document that no longer validates.
 */
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** Whether a Path Item member names an operation rather than path metadata. */
export function isHttpMethod(member: string): boolean {
  return HTTP_METHODS.has(member.toLowerCase());
}

/**
 * A registered route's path, spelled the way the OpenAPI document spells
 * it. Hono writes `:id` where the document writes `{id}` and may pin it to
 * a matcher pattern (`/:id{.+}`); carrying that through produced an
 * undocumented path that kept the document-wide security default instead
 * of the route's real credential class. The inner alternation allows one
 * level of nesting so a quantifier (`{[0-9]{3}}`) is consumed whole.
 */
export function documentedPathOf(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)(\{(?:[^{}]|\{[^{}]*\})*\})?/g, "{$1}");
}

/**
 * Which security schemes the published document offers for each credential
 * class. Only classes an API consumer can actually present appear; the
 * omission is the point, since an empty requirement list means "no
 * credential required", which is true of a public route and false of a
 * session-only or internal one — those two are refused, not published.
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
 * credential class its route enforces. Throws when the class is one an API
 * client cannot present (session cookie, internal shared secret) — writing
 * an empty requirement instead would make every generated client emit an
 * unauthenticated call, so this fails the generator rather than shipping.
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
