/**
 * Refuses a statement that is not scoped to exactly one tenant.
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
const BOUND_TENANT_PREDICATE = /(?:^|[\s.(])TenantId\s*=\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/i;

/** `TenantId = 'literal'` or `= "literal"`, which is never acceptable. */
const LITERAL_TENANT_PREDICATE = /(?:^|[\s.(])TenantId\s*=\s*(?:'[^']*'|"[^"]*")/i;

/**
 * Blanks out comment bodies and string-literal bodies, keeping every other character at its
 * original index.
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
 * Reports an `OR` that can disjoin the tenant predicate away. Depth is the test. An `OR` nested
 * inside a bracketed group cannot weaken a predicate outside it, so only one at the predicate's
 * own depth or shallower counts.
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

  if (hasWeakeningDisjunction({ masked: statement, predicateIndex: bound.index })) {
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

/**
 * The tenant predicate forms the repositories genuinely write. Wider than {@link
 * BOUND_TENANT_PREDICATE} on purpose: that one backs the `QueryRequest` path, where the bound
 * value is also checked against the caller's tenant and so has to name exactly one parameter.
 */
const SCOPED_PREDICATE =
  /(?:^|[\s.(])(?:TenantId|tenant_id|project_id|ProjectId)\s*(?:=|IN)\s*\(?\s*\{\s*[A-Za-z_][A-Za-z0-9_]*\s*:/i;

const LITERAL_PREDICATE =
  /(?:^|[\s.(])(?:TenantId|tenant_id|project_id|ProjectId)\s*=\s*(?:'[^']*'|"[^"]*")/i;

/**
 * Returns the reason a statement names no tenant, or null when it names one. Text only: no
 * parameters, no claimed tenant.
 */
export function checkStatementTenantScope({ sql }: { sql: string }): TenantScopeViolation | null {
  const statement = maskNonCode(sql);
  if (SCOPED_PREDICATE.test(statement)) return null;
  return LITERAL_PREDICATE.test(statement)
    ? { kind: "literal-predicate" }
    : { kind: "missing-predicate" };
}

/** The first table the statement names, for the refusal message. */
export function tableNamedBy(sql: string): string {
  const match =
    /(?:^|[\s(])(?:FROM|INSERT\s+INTO|ALTER\s+TABLE|OPTIMIZE\s+TABLE)\s+([A-Za-z_][A-Za-z0-9_.]*)/i.exec(
      maskNonCode(sql),
    );
  return match?.[1] ?? "unknown";
}

export class TenantScopeError extends Error {
  constructor(
    public readonly violation: TenantScopeViolation,
    public readonly tenantId: string,
  ) {
    super(`${describeTenantScopeViolation(violation)} (tenant "${tenantId}")`);
    this.name = "TenantScopeError";
  }
}

/** The sentence a refusal reads out, shared by both guards. */
export function describeTenantScopeViolation(violation: TenantScopeViolation): string {
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
 * Refuses a statement that cannot name its tenant. Placed outermost by {@link
 * ClickHouseQueryClient}: refusing costs nothing, and it should happen before a rate-limit slot
 * or a retry budget is spent on a statement that must not run.
 */
export class TenantGuard {
  private readonly onUnscoped: ((request: QueryRequest) => void) | undefined;

  constructor({ onUnscoped }: TenantGuardOptions = {}) {
    this.onUnscoped = onUnscoped;
  }

  /**
   * Throws {@link TenantScopeError} unless the statement is tenant-scoped or declares a written
   * reason for not being. Returns nothing on success rather than the request: it is a check,
   * and a caller that had to remember to use a returned value could forget to.
   */
  assert(request: QueryRequest): void {
    if (request.unscoped !== undefined) {
      // Guarded because `onUnscoped` is host code - an audit log, a counter - and this branch
      // is the one where the guard has already decided to allow. An exception from it would
      // propagate out of `assert` and refuse a statement the guard just approved, which is a
      // reporting hook deciding policy. Observability must not change what it observes; see
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
