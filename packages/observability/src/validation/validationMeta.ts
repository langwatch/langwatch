/**
 * Structured metadata describing why a payload failed validation, built so it
 * can be logged and aggregated without carrying any of the payload.
 *
 * The question this exists to answer is "is the sender wrong, or is our schema
 * too strict?". Answering it needs the shape of the failure — which field, and
 * what we demanded of it — and never needs the value. So the split this module
 * enforces is by authorship: a path, an issue code, a bound and a list of
 * allowed options are our own schema's vocabulary and are safe to emit; the
 * value that arrived is the customer's and is not.
 *
 * That split is why fields are copied by an allow-list per issue code rather
 * than spread. Two of Zod's own fields would otherwise leak content:
 *
 *   - `message` embeds the received value for several codes ("Invalid enum
 *     value. Expected 'a' | 'b', received '<their value>'").
 *   - `received` is a type name for `invalid_type` and the literal value for
 *     `invalid_literal` / `invalid_enum_value`.
 *
 * Duck-typed on purpose: this package does not depend on zod, the same way
 * `handledFaultOf` does not depend on the HandledError class. Anything with an
 * `issues` array of the documented shape works.
 */

/** The most issues one record carries before it is truncated. */
export const MAX_VALIDATION_ISSUES = 20;

export interface ValidationIssueMeta {
  /** Dotted path with array indices, e.g. `spans[0].timestamps.started_at`. */
  path: string;
  /** Zod issue code, e.g. `invalid_type`, `unrecognized_keys`. */
  code: string;
  /** Type or literal kind the schema demanded. Never a customer value. */
  expected?: string;
  /** Type name that arrived. Only ever set for `invalid_type`. */
  received?: string;
  /**
   * Keys the schema refused.
   *
   * These are field NAMES, chosen by the sender's instrumentation rather than
   * carried as content, and they are the single most useful signal here: the
   * same key refused across many projects means an SDK emits something we have
   * not modelled, and the fix is ours.
   */
  keys?: string[];
  /** Values the schema allows. Ours, from the schema definition. */
  options?: string[];
  /** Named string rule that failed, e.g. `url`, `uuid`, `datetime`. */
  rule?: string;
  /** Bound the value missed, for `too_small` / `too_big`. */
  limit?: number;
}

export interface ValidationMeta {
  /** Total issues found, whether or not they all fit in `issues`. */
  issueCount: number;
  issues: ValidationIssueMeta[];
  /** Present and true only when `issues` holds fewer than `issueCount`. */
  truncated?: boolean;
}

interface RawIssue {
  code?: unknown;
  path?: unknown;
  expected?: unknown;
  received?: unknown;
  keys?: unknown;
  options?: unknown;
  validation?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  unionErrors?: unknown;
}

function hasIssues(error: unknown): error is { issues: RawIssue[] } {
  return (
    !!error &&
    typeof error === "object" &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

/**
 * `["spans", 0, "timestamps", "started_at"]` -> `spans[0].timestamps.started_at`.
 * An empty path means the root, which reads better as `<root>` than as "".
 */
function formatPath(path: unknown): string {
  if (!Array.isArray(path) || path.length === 0) return "<root>";

  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
      continue;
    }
    out += out === "" ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((entry) => String(entry));
}

/**
 * Copy only the fields this issue code is known to populate with our own
 * vocabulary. Anything not named here is dropped, so a Zod version that adds a
 * field cannot start leaking content without this list changing first.
 */
function metaForIssue(issue: RawIssue): ValidationIssueMeta {
  const meta: ValidationIssueMeta = {
    path: formatPath(issue.path),
    code: typeof issue.code === "string" ? issue.code : "unknown",
  };

  switch (meta.code) {
    case "invalid_type":
      // Both sides are type names here ("string", "undefined"), not values.
      if (typeof issue.expected === "string") meta.expected = issue.expected;
      if (typeof issue.received === "string") meta.received = issue.received;
      break;

    case "unrecognized_keys":
      meta.keys = stringList(issue.keys);
      break;

    case "invalid_enum_value":
    case "invalid_union_discriminator":
      // `options` is the schema's own list. `received` is deliberately not
      // copied: for these codes it holds the value that arrived.
      meta.options = stringList(issue.options);
      break;

    case "invalid_literal":
      // `expected` is the literal our schema declares, so it is ours to log.
      if (
        typeof issue.expected === "string" ||
        typeof issue.expected === "number"
      ) {
        meta.expected = String(issue.expected);
      }
      break;

    case "invalid_string":
      if (typeof issue.validation === "string") meta.rule = issue.validation;
      break;

    case "too_small":
      if (typeof issue.minimum === "number") meta.limit = issue.minimum;
      break;

    case "too_big":
      if (typeof issue.maximum === "number") meta.limit = issue.maximum;
      break;

    default:
      break;
  }

  return meta;
}

/**
 * Flatten a Zod error into issues, following `invalid_union` into the branch
 * errors it nests. A union failure whose branches are hidden reports only that
 * "something did not match", which is the least useful thing it could say.
 *
 * Counts every issue but only builds the ones that will be kept. The input here
 * is an untrusted body - up to 10 MiB and a couple of hundred spans, each
 * checked against union schemas that fan out a branch of issues per arm - so
 * the difference between counting a large tree and materialising one is worth
 * having on a path that runs per rejected request.
 */
function collectIssues(
  issues: RawIssue[],
  into: ValidationIssueMeta[],
  counter: { total: number },
  maxIssues: number,
): void {
  for (const issue of issues) {
    counter.total += 1;
    if (into.length < maxIssues) into.push(metaForIssue(issue));

    if (Array.isArray(issue.unionErrors)) {
      for (const nested of issue.unionErrors) {
        if (hasIssues(nested)) {
          collectIssues(nested.issues, into, counter, maxIssues);
        }
      }
    }
  }
}

/**
 * Build loggable metadata from a validation error, or `undefined` when the
 * error is not one — so a caller can spread the result and get nothing extra
 * for a non-validation failure.
 */
export function validationMeta(
  error: unknown,
  { maxIssues = MAX_VALIDATION_ISSUES }: { maxIssues?: number } = {},
): ValidationMeta | undefined {
  if (!hasIssues(error)) return undefined;

  const issues: ValidationIssueMeta[] = [];
  const counter = { total: 0 };
  collectIssues(error.issues, issues, counter, maxIssues);

  const meta: ValidationMeta = { issueCount: counter.total, issues };
  if (counter.total > issues.length) meta.truncated = true;

  return meta;
}
