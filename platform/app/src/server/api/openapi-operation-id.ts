/**
 * The operationId scheme the published document has always used.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `operationId` is not decoration. `openapi-python-client` turns it into the
 * Python SDK's function name, so the ids are a published API surface: renaming
 * one renames a function our users call.
 *
 * hono-openapi derives an id from the method and path when a route does not
 * name its own. v0.4 capitalised the first character of each path segment and
 * left the rest alone; v1 pascal-cases the whole segment, splitting on every
 * non-word character. The two disagree wherever a segment contains a hyphen or
 * an underscore:
 *
 *     /api/coding-agent/pull-request-usage
 *       v0.4  getApiCoding-agentPull-request-usage
 *       v1    getApiCodingAgentPullRequestUsage
 *
 * That is 49 of the document's 264 operations — every dashed or underscored
 * path, which is most of the gateway, governance and model families.
 *
 * v1's ids are the better ids. They are also a breaking change to every
 * generated client, and a library upgrade is the wrong moment to ship one: the
 * two decisions want separate PRs and separate release notes. So the upgrade
 * preserves the scheme, and taking the improvement stays available as its own
 * deliberate change — stop calling `restoreLegacyOperationIds`, regenerate, and
 * the 49 ids move.
 *
 * ── WHY A REWRITE AND NOT `defaultOptions` ─────────────────────────────────
 *
 * Passing `operationId` through `generateSpecs`'s `defaultOptions` looks like
 * the intended seam and quietly does the wrong thing. A route contributes one
 * spec fragment per middleware, and they are merged in registration order with
 * the later one winning. `describeRoute`'s own fragment beats the defaults, but
 * the validator middleware that follows it does not carry the route's spec — so
 * the default lands last and overwrites the hand-written id. Measured: it fixed
 * the 49 derived ids and clobbered 24 explicit ones (`createApiKey` became
 * `postApiApi-keys`), trading one breaking rename for another.
 *
 * Rewriting the finished document instead makes the rule explicit: an id is
 * replaced only when it is exactly what v1 would have derived, which is to say
 * only when nobody named it.
 */

/** v1's path-segment normaliser: hono's `:param` becomes OpenAPI's `{param}`. */
function toOpenApiPathSegment(segment: string): string {
  if (!segment.startsWith(":")) return segment;

  const withRegex = segment.match(/^:([^{?]+)(?:{(.+)})?(\?)?$/);
  if (withRegex) return `{${withRegex[1]}}`;

  return `{${segment.slice(1).replace(/\?$/, "")}}`;
}

/** Upper-cases the first character only — v0.4's rule. */
function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Splits on every non-word character and joins the capitalised parts — v1's rule. */
function toPascalCase(text: string): string {
  return text
    .split(/[\W_]+/)
    .filter(Boolean)
    .map(capitalizeFirst)
    .join("");
}

/**
 * The id one of the two schemes derives for a route.
 *
 * Both walk the path identically and differ only in how a single segment
 * becomes a name, so they share one traversal and take the casing rule as an
 * argument. Keeping them together is what makes them comparable: the rewrite
 * below is only sound while these two agree on everything except the casing.
 */
function deriveOperationId(
  method: string,
  path: string,
  caseSegment: (segment: string) => string,
): string {
  const id = method.toLowerCase();
  if (path === "/") return `${id}Index`;

  return path.split("/").reduce((acc, rawSegment) => {
    const segment = toOpenApiPathSegment(rawSegment);
    return segment.startsWith("{")
      ? `${acc}By${caseSegment(segment.slice(1, -1))}`
      : `${acc}${caseSegment(segment)}`;
  }, id);
}

/** The id hono-openapi v1 derives when a route names none. */
export function derivedOperationIdV1(method: string, path: string): string {
  return deriveOperationId(method, path, toPascalCase);
}

/** The id hono-openapi v0.4 derived — the one the published document carries. */
export function derivedOperationIdLegacy(method: string, path: string): string {
  return deriveOperationId(method, path, capitalizeFirst);
}

const OPENAPI_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

interface OperationLike {
  operationId?: string;
}

/**
 * Just enough of a generated document to walk it.
 *
 * `paths` is `Record<string, unknown>` rather than a map of operations because
 * a hono-openapi path item carries `servers` and `parameters` alongside its
 * methods. Naming only the methods would make the real type fail to match, and
 * the generic would silently widen to this interface — losing the caller's
 * concrete type on the way out.
 */
interface SpecLike {
  paths?: Record<string, unknown>;
}

/**
 * Puts the v0.4 id back on every operation whose id v1 derived for itself.
 *
 * An operation that names its own `operationId` is left exactly as it is,
 * because a hand-written id never equals the derived one it was written to
 * replace.
 */
/** Swaps one operation's id, if and only if v1 is the one that derived it. */
function restoreOperationId(
  operation: OperationLike | undefined,
  method: string,
  path: string,
): void {
  if (!operation?.operationId) return;
  if (operation.operationId !== derivedOperationIdV1(method, path)) return;

  operation.operationId = derivedOperationIdLegacy(method, path);
}

/** Every operation hanging off one path. */
function restorePathItem(rawItem: unknown, path: string): void {
  const item = rawItem as Record<string, OperationLike | undefined> | undefined;
  if (!item) return;

  for (const method of OPENAPI_METHODS) {
    restoreOperationId(item[method], method, path);
  }
}

export function restoreLegacyOperationIds<T extends SpecLike>(spec: T): T {
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    restorePathItem(rawItem, path);
  }

  return spec;
}
