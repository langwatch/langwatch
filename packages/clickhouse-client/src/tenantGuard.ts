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
 * Known and accepted limits, each pinned by a test in ./tenantGuard.test.ts so
 * they stay documented rather than becoming folklore. One match anywhere in the
 * statement satisfies the whole statement, so all of these pass:
 *
 *   - a disjunction: `WHERE TenantId = {t:String} OR Status = 'x'` matches, and
 *     returns every tenant's rows. This is the one a regex cannot see, and the
 *     reason this check is a backstop rather than the isolation mechanism.
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

import type { QueryMiddleware, QueryRequest } from "./pipeline";

export type TenantScopeViolation =
  | { kind: "missing-predicate" }
  | { kind: "literal-predicate" }
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
 * Removes `--` line comments and block comments before matching.
 *
 * Without this the guard misses the case it most exists for: someone debugging
 * comments the WHERE clause out, and the statement then reads every tenant's
 * rows while still visibly "containing" the predicate.
 */
function withoutComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
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
  const statement = withoutComments(sql);
  const bound = BOUND_TENANT_PREDICATE.exec(statement);

  if (bound === null) {
    return LITERAL_TENANT_PREDICATE.test(statement)
      ? { kind: "literal-predicate" }
      : { kind: "missing-predicate" };
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
 * Middleware form. Place it outermost: refusing costs nothing, and it should
 * happen before a rate-limit slot or a retry budget is spent on a statement
 * that must not run.
 */
export function tenantGuard({
  onUnscoped,
}: TenantGuardOptions = {}): QueryMiddleware {
  return (next) => async (request) => {
    if (request.unscoped !== undefined) {
      onUnscoped?.(request);
      return next(request);
    }

    const violation = checkTenantScope({
      sql: request.sql,
      params: request.params,
      tenantId: request.tenantId,
    });
    if (violation !== null) {
      throw new TenantScopeError(violation, request.tenantId);
    }

    return next(request);
  };
}
