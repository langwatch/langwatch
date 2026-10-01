/**
 * Structured metadata for validation failures: schema details without customer
 * values, logged and aggregated to diagnose sender vs schema strictness.
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
   * Keys the schema refused — field NAMES chosen by the sender's
   * instrumentation, not content, and the single most useful signal here:
   * the same key across many projects means an unmodelled SDK field we must fix.
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
  /** Zod 4 spellings: the permitted set, and the named string format. */
  values?: unknown;
  format?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  /** Zod 3 spelling of a union's per-arm failures: one `ZodError` per arm. */
  unionErrors?: unknown;
  /** Zod 4 spelling of the same: one array of issues per arm. */
  errors?: unknown;
}

function hasIssues(error: unknown): error is { issues: RawIssue[] } {
  return (
    !!error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)
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

type IssueFieldReader = (issue: RawIssue, schemaOnly: boolean) => Partial<ValidationIssueMeta>;

const optionsFrom: IssueFieldReader = (issue) => ({ options: stringList(issue.options) });

/** The fields each issue code carries in our own vocabulary; see `metaForIssue`. */
const ISSUE_FIELD_READERS: ReadonlyMap<string, IssueFieldReader> = new Map<
  string,
  IssueFieldReader
>([
  [
    "invalid_type",
    // Both sides are type names here ("string", "undefined"), not values.
    (issue) => ({
      ...(typeof issue.expected === "string" ? { expected: issue.expected } : {}),
      ...(typeof issue.received === "string" ? { received: issue.received } : {}),
    }),
  ],
  [
    "unrecognized_keys",
    (issue, schemaOnly) => (schemaOnly ? {} : { keys: stringList(issue.keys) }),
  ],
  // `options` is the schema list; `received` holds the value that arrived, so it is not copied.
  ["invalid_enum_value", optionsFrom],
  ["invalid_union_discriminator", optionsFrom],
  // Zod 4 folds enum and literal mismatches into one code carrying the permitted set as `values`.
  ["invalid_value", (issue) => ({ options: stringList(issue.values) })],
  ["invalid_union", (issue) => (issue.options === undefined ? {} : optionsFrom(issue, false))],
  [
    "invalid_literal",
    // `expected` is the literal our schema declares, so it is ours to log.
    (issue) =>
      typeof issue.expected === "string" || typeof issue.expected === "number"
        ? { expected: String(issue.expected) }
        : {},
  ],
  // `invalid_string` in zod 3, `invalid_format` in zod 4; the rule name moved to `format`.
  ["invalid_format", (issue) => (typeof issue.format === "string" ? { rule: issue.format } : {})],
  [
    "invalid_string",
    (issue) => (typeof issue.validation === "string" ? { rule: issue.validation } : {}),
  ],
  ["too_small", (issue) => (typeof issue.minimum === "number" ? { limit: issue.minimum } : {})],
  ["too_big", (issue) => (typeof issue.maximum === "number" ? { limit: issue.maximum } : {})],
]);

/**
 * Copy only the fields this issue code is known to populate with our own
 * vocabulary. Anything not named here is dropped, so a Zod version that adds a
 * field cannot start leaking content without this list changing first.
 */
function metaForIssue(issue: RawIssue, schemaOnly: boolean): ValidationIssueMeta {
  const meta: ValidationIssueMeta = {
    // Record-map keys and unrecognised keys can be caller content. Output
    // validation therefore uses schema-only metadata and omits every path.
    path: schemaOnly ? "<redacted>" : formatPath(issue.path),
    code: typeof issue.code === "string" ? issue.code : "unknown",
  };

  const readFields = ISSUE_FIELD_READERS.get(meta.code);
  if (readFields) Object.assign(meta, readFields(issue, schemaOnly));

  return meta;
}

/**
 * The per-arm issues of a union failure: handles both Zod 3 `unionErrors` and
 * Zod 4 `errors` spellings.
 */
function unionBranches(issue: RawIssue): RawIssue[][] {
  if (Array.isArray(issue.unionErrors)) {
    return issue.unionErrors.filter(hasIssues).map((nested) => nested.issues);
  }
  if (Array.isArray(issue.errors)) {
    return issue.errors.filter((branch): branch is RawIssue[] => Array.isArray(branch));
  }
  return [];
}

/**
 * Flatten a Zod error into issues: follows invalid_union branches and counts
 * all issues but only materializes kept ones.
 */
function collectIssues({
  issues,
  into,
  counter,
  maxIssues,
  schemaOnly,
}: {
  issues: RawIssue[];
  into: ValidationIssueMeta[];
  counter: { total: number };
  maxIssues: number;
  schemaOnly: boolean;
}): void {
  for (const issue of issues) {
    counter.total += 1;
    if (into.length < maxIssues) into.push(metaForIssue(issue, schemaOnly));

    for (const branch of unionBranches(issue)) {
      collectIssues({ issues: branch, into, counter, maxIssues, schemaOnly });
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
  {
    maxIssues = MAX_VALIDATION_ISSUES,
    privacy = "standard",
  }: { maxIssues?: number; privacy?: "standard" | "schema-only" } = {},
): ValidationMeta | undefined {
  if (!hasIssues(error)) return undefined;

  const issues: ValidationIssueMeta[] = [];
  const counter = { total: 0 };
  collectIssues({
    issues: error.issues,
    into: issues,
    counter,
    maxIssues,
    schemaOnly: privacy === "schema-only",
  });

  const meta: ValidationMeta = { issueCount: counter.total, issues };
  if (counter.total > issues.length) meta.truncated = true;

  return meta;
}
