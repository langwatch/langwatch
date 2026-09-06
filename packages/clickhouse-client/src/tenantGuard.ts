/**
 * Refuses a statement that is not scoped to exactly one tenant.
 *
 * In this schema no identifier other than `TenantId` is unique across tenants -
 * a TraceId, a RunId or a SpanId can collide between customers - so a read that
 * omits the tenant predicate does not merely return too much, it returns
 * somebody else's rows. The failure is silent: the query succeeds, the shape is
 * right, and nothing looks wrong until a customer reports seeing data that is
 * not theirs.
 *
 * This is a guard against omission, not a security boundary. It matches on the
 * statement text, so the thing it has to stop is a normal engineer writing a
 * normal query and forgetting a WHERE clause. Real isolation is enforced by the
 * routing in ./tenancy.ts and by the credentials the server was given.
 *
 * A disjunction is refused rather than merely noted. `WHERE TenantId = {t} OR
 * Status = 'x'` contains the predicate and still returns every tenant's rows,
 * and it is not an exotic statement - it is what operator precedence produces
 * when somebody writes `WHERE TenantId = {t} AND A OR B` meaning `AND (A OR
 * B)`. Any `OR` at or above the predicate's parenthesis depth can weaken it, so
 * that is the rule: an `OR` nested deeper is inside a group and harmless, one
 * at the same depth or shallower is refused. Putting brackets round the
 * disjunction both satisfies the guard and fixes the query.
 *
 * Known and accepted limits, each pinned by a test in ./tenantGuard.test.ts so
 * they stay documented rather than becoming folklore. One match anywhere in the
 * statement satisfies the whole statement, so these still pass:
 *
 *   - a UNION whose second arm is unscoped.
 *   - a JOIN where only one side is scoped.
 *   - a scoped subquery or CTE beneath an unscoped outer query.
 *
 * Closing these needs a parser. If that day comes, the shape of this function
 * does not have to change - only `checkTenantScope`'s internals.
 *
 * The predicate must bind a parameter rather than inline a literal. An inlined
 * tenant is a string built by concatenation somewhere, which is the shape that
 * eventually becomes an injection, and it cannot be checked against the tenant
 * the caller claims to be acting for.
 */

import { quietly } from "./observability";
import type { QueryRequest } from "./query";

export type TenantScopeViolation =
  | { kind: "missing-predicate" }
  | { kind: "literal-predicate" }
  | { kind: "weakening-disjunction" }
  | { kind: "missing-param"; param: string }
  | {
      kind: "param-mismatch";
      param: string;
      expected: string;
      actual: unknown;
    };

/** `TenantId = {someName:String}`, allowing an optional table alias. */
const BOUND_TENANT_PREDICATE =
  /(?:^|[\s.(])TenantId\s*=\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/i;

/** `TenantId = 'literal'` or `= "literal"`, which is never acceptable. */
const LITERAL_TENANT_PREDICATE =
  /(?:^|[\s.(])TenantId\s*=\s*(?:'[^']*'|"[^"]*")/i;

/**
 * Returns the reason a statement is not tenant-scoped, or null when it is.
 *
 * Pure, so the rule can be exercised over a table of statements without a
 * driver, a server, or a pipeline.
 */
/**
 * Blanks out comment bodies and string-literal bodies, keeping every other
 * character at its original index.
 *
 * Comments have to go before matching or the guard misses the case it most
 * exists for: someone debugging comments the WHERE clause out, and the
 * statement then reads every tenant's rows while still visibly "containing" the
 * predicate. String bodies go too, so that a literal containing `OR`, `--` or
 * `/*` cannot steer any of the checks below.
 *
 * Written as one pass rather than a pair of replaces because the obvious
 * `/\/\*[\s\S]*?\*\//` backtracks: against a long run of unterminated `/*` each
 * start position rescans to the end of the input, which is quadratic in the
 * length of the statement and reachable from any caller that builds SQL from
 * input it did not write. Here every character is visited once.
 *
 * Length is preserved so the returned indices still address the original text.
 */
function maskNonCode(sql: string): string {
  const out = [...sql];

  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };

  let cursor = 0;
  while (cursor < sql.length) {
    const pair = sql.slice(cursor, cursor + 2);

    if (pair === "/*") {
      const close = sql.indexOf("*/", cursor + 2);
      const end = close === -1 ? sql.length : close + 2;
      blank(cursor, end);
      cursor = end;
      continue;
    }

    if (pair === "--") {
      const newline = sql.indexOf("\n", cursor);
      const end = newline === -1 ? sql.length : newline;
      blank(cursor, end);
      cursor = end;
      continue;
    }

    const quote = sql[cursor];
    if (quote === "'" || quote === '"' || quote === "`") {
      let scan = cursor + 1;
      while (scan < sql.length) {
        if (sql[scan] === "\\") {
          scan += 2;
          continue;
        }
        if (sql[scan] === quote) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (sql[scan + 1] === quote) {
            scan += 2;
            continue;
          }
          break;
        }
        scan += 1;
      }
      // The delimiters stay, so `TenantId = 'x'` is still recognisably a
      // literal predicate rather than becoming a bare `TenantId =`.
      blank(cursor + 1, Math.min(scan, sql.length));
      cursor = Math.min(scan + 1, sql.length);
      continue;
    }

    cursor += 1;
  }

  return out.join("");
}

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z0-9_]/.test(character);

/**
 * Reports an `OR` that can disjoin the tenant predicate away.
 *
 * Depth is the test. An `OR` nested inside a bracketed group cannot weaken a
 * predicate outside it, so only one at the predicate's own depth or shallower
 * counts. That accepts `TenantId = {t} AND (a OR b)` and refuses both
 * `TenantId = {t} OR a` and `(TenantId = {t}) OR a`.
 *
 * One pass, so this cannot become the quadratic thing `maskNonCode` just
 * stopped being.
 */
function hasWeakeningDisjunction({
  masked,
  predicateIndex,
}: {
  masked: string;
  predicateIndex: number;
}): boolean {
  const disjunctionDepths: number[] = [];
  let depth = 0;
  let predicateDepth = 0;

  for (let i = 0; i < masked.length; i++) {
    if (i === predicateIndex) predicateDepth = depth;

    const character = masked[i];
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      continue;
    }

    // `\bOR\b` by hand, so `ORDER BY` and a column called `colour` are not ORs.
    if (
      (character === "o" || character === "O") &&
      (masked[i + 1] === "r" || masked[i + 1] === "R") &&
      !isWordCharacter(masked[i - 1]) &&
      !isWordCharacter(masked[i + 2])
    ) {
      disjunctionDepths.push(depth);
    }
  }

  return disjunctionDepths.some((each) => each <= predicateDepth);
}

export function checkTenantScope({
  sql,
  params,
  tenantId,
}: {
  sql: string;
  params?: Record<string, unknown> | undefined;
  tenantId: string;
}): TenantScopeViolation | null {
  const statement = maskNonCode(sql);
  const bound = BOUND_TENANT_PREDICATE.exec(statement);

  if (bound === null) {
    return LITERAL_TENANT_PREDICATE.test(statement)
      ? { kind: "literal-predicate" }
      : { kind: "missing-predicate" };
  }

  if (
    hasWeakeningDisjunction({ masked: statement, predicateIndex: bound.index })
  ) {
    return { kind: "weakening-disjunction" };
  }

  const param = bound[1] as string;
  const supplied = params?.[param];

  if (supplied === undefined) return { kind: "missing-param", param };
  if (supplied !== tenantId) {
    return {
      kind: "param-mismatch",
      param,
      expected: tenantId,
      actual: supplied,
    };
  }
  return null;
}

export class TenantScopeError extends Error {
  constructor(
    public readonly violation: TenantScopeViolation,
    public readonly tenantId: string,
  ) {
    super(`${describe(violation)} (tenant "${tenantId}")`);
    this.name = "TenantScopeError";
  }
}

function describe(violation: TenantScopeViolation): string {
  switch (violation.kind) {
    case "missing-predicate":
      return "Statement has no `TenantId = {param:String}` predicate. No other id in this schema is unique across tenants, so this would read another tenant's rows. Add the predicate, or declare `unscoped: { reason }` if the statement genuinely spans tenants.";
    case "literal-predicate":
      return "Statement inlines the tenant as a literal instead of binding a parameter. Bind it, so it can be checked against the caller's tenant and cannot be built by concatenation.";
    case "weakening-disjunction":
      return "Statement has an `OR` that can disjoin the tenant predicate away, which would return every tenant's rows. Bracket the disjunction so it cannot weaken the tenant scoping, or declare `unscoped: { reason }` if the statement genuinely spans tenants.";
    case "missing-param":
      return `Statement binds tenant parameter "${violation.param}" but no such parameter was supplied.`;
    case "param-mismatch":
      return `Statement binds tenant parameter "${violation.param}" to a different tenant than the request claims.`;
  }
}

export interface TenantGuardOptions {
  /** Called for each declared-unscoped statement, so they can be audited. */
  onUnscoped?: ((request: QueryRequest) => void) | undefined;
}

/**
 * Refuses a statement that cannot name its tenant.
 *
 * Placed outermost by {@link ClickHouseQueryClient}: refusing costs nothing,
 * and it should happen before a rate-limit slot or a retry budget is spent on a
 * statement that must not run.
 */
export class TenantGuard {
  private readonly onUnscoped:
    | ((request: QueryRequest) => void)
    | undefined;

  constructor({ onUnscoped }: TenantGuardOptions = {}) {
    this.onUnscoped = onUnscoped;
  }

  /**
   * Throws {@link TenantScopeError} unless the statement is tenant-scoped or
   * declares a written reason for not being.
   *
   * Returns nothing on success rather than the request: it is a check, and a
   * caller that had to remember to use a returned value could forget to.
   */
  assert(request: QueryRequest): void {
    if (request.unscoped !== undefined) {
      // Guarded because `onUnscoped` is host code - an audit log, a counter -
      // and this branch is the one where the guard has already decided to
      // allow. An exception from it would propagate out of `assert` and refuse
      // a statement the guard just approved, which is a reporting hook
      // deciding policy. Observability must not change what it observes; see
      // ./observability.ts.
      quietly(() => this.onUnscoped?.(request));
      return;
    }

    const violation = checkTenantScope({
      sql: request.sql,
      params: request.params,
      tenantId: request.tenantId,
    });
    if (violation !== null) {
      throw new TenantScopeError(violation, request.tenantId);
    }
  }
}
