/**
 * The ClickHouse objects behind the app functions: one SQL UDF each, which
 * projects its key arguments and nothing else, so a caller's statement runs
 * verbatim while the returned column already carries the key hydration needs.
 * @see specs/lwql/app-functions.feature
 */

import {
  LWQL_APP_FUNCTION_CATALOG,
  lwqlAppFunctionKeyParameters,
  lwqlAppFunctionNames,
} from "../rules/langwatch-ql-app-function-catalog.rules.ts";
import type { LangWatchQLAppFunctionDefinition } from "../rules/langwatch-ql-app-function-shapes.rules.ts";
import { clickHouseLiteral } from "../rules/langwatch-ql-sql-literal.rules.ts";
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service.ts";

/** The origin `system.functions` reports for a function created by SQL DDL. */
export const LWQL_SQL_UDF_ORIGIN = "SQLUserDefined";

/** One row of the reconciliation query. */
export interface LangWatchQLServerFunctionRow {
  readonly name: string;
  readonly origin: string;
  /** The normalised DDL the server stored. Empty for a builtin. */
  readonly create_query?: string;
}

/** A declared name the server holds as something other than our own UDF. */
export interface LangWatchQLAppFunctionConflict {
  readonly name: string;
  /** What the server says it is. `System` for a builtin. */
  readonly origin: string;
  /** Why it conflicts, so an operator knows which of the two they are facing. */
  readonly reason: "origin" | "definition";
  /** The body the server holds, for a definition conflict. */
  readonly createQuery?: string;
}

export class LangWatchQLAppFunctionStatementsService {
  static create(): LangWatchQLAppFunctionStatementsService {
    return new LangWatchQLAppFunctionStatementsService(LangWatchQLSqlTextService.create());
  }

  private constructor(private readonly sqlText: LangWatchQLSqlTextService) {}

  /**
   * The body of one function's UDF: its key arguments, projected. `tuple(...)`
   * where the key is a pair, because the identity would return only the first
   * half and the application would hold a trace id with no span id.
   */
  functionBody(definition: LangWatchQLAppFunctionDefinition): string {
    const keys = this.keyNames(definition);
    const [only] = keys;
    if (only === undefined) {
      throw new Error(
        `lwql app functions: "${definition.name}" declares no key parameter, so there is nothing for its UDF to project`,
      );
    }
    return keys.length === 1 ? only : `tuple(${keys.join(", ")})`;
  }

  /**
   * The `create_query` the server stores for one of our functions — not the
   * statement we submit: ClickHouse drops the parentheses around a single
   * parameter and rewrites `tuple(a, b)` as `(a, b)`.
   */
  storedCreateQuery(definition: LangWatchQLAppFunctionDefinition): string {
    const name = this.sqlText.assertIdentifier(definition.name, "app function name");
    const parameters = this.parameterNames(definition);
    const declared = parameters.length === 1 ? parameters[0] : `(${parameters.join(", ")})`;
    const keys = this.keyNames(definition);
    const body = keys.length === 1 ? keys[0] : `(${keys.join(", ")})`;
    return `CREATE FUNCTION ${name} AS ${declared} -> ${body}`;
  }

  /** One function's `CREATE OR REPLACE FUNCTION` statement. */
  functionStatement(definition: LangWatchQLAppFunctionDefinition): string {
    const name = this.sqlText.assertIdentifier(definition.name, "app function name");
    const parameters = this.parameterNames(definition).join(", ");
    return (
      `CREATE OR REPLACE FUNCTION ${name} AS (${parameters}) -> ` + this.functionBody(definition)
    );
  }

  /**
   * Every app function's DDL, in catalog order. `OR REPLACE` throughout, so a
   * re-run converges rather than failing on what is already there.
   */
  functionStatements({
    functions = LWQL_APP_FUNCTION_CATALOG,
  }: {
    functions?: readonly LangWatchQLAppFunctionDefinition[];
  } = {}): string[] {
    return functions.map((definition) => this.functionStatement(definition));
  }

  /**
   * Asks the server what it holds for exactly the declared names, `origin` and
   * `create_query` both: a future builtin shows up as another origin, and
   * somebody else's UDF as the same origin with a body that is not ours.
   */
  reconciliationQuery({
    functions = LWQL_APP_FUNCTION_CATALOG,
  }: {
    functions?: readonly LangWatchQLAppFunctionDefinition[];
  } = {}): string {
    const names = lwqlAppFunctionNames(functions)
      .map((name) => clickHouseLiteral(name))
      .join(", ");
    return `SELECT name, origin, create_query FROM system.functions WHERE name IN (${names}) ORDER BY name`;
  }

  /**
   * The declared names the server already owns as something else. Empty is the
   * healthy state and also the honest answer before the first run: a name with
   * no row is a function the create statement is about to add.
   */
  findConflicts({
    rows,
    functions = LWQL_APP_FUNCTION_CATALOG,
  }: {
    rows: readonly LangWatchQLServerFunctionRow[];
    functions?: readonly LangWatchQLAppFunctionDefinition[];
  }): readonly LangWatchQLAppFunctionConflict[] {
    const declared = new Map(
      functions.map((definition) => [definition.name, this.storedCreateQuery(definition)]),
    );
    const conflicts: LangWatchQLAppFunctionConflict[] = [];
    for (const row of rows) {
      const expected = declared.get(row.name);
      if (expected === undefined) continue;
      if (row.origin !== LWQL_SQL_UDF_ORIGIN) {
        conflicts.push({ name: row.name, origin: row.origin, reason: "origin" });
        continue;
      }
      // A row with no definition to compare is treated as ours: an older
      // server that does not expose `create_query` must not turn every
      // provisioning run into a refusal.
      const stored = row.create_query;
      if (stored === undefined || stored === "") continue;
      if (normaliseCreateQuery(stored) === normaliseCreateQuery(expected)) continue;
      conflicts.push({
        name: row.name,
        origin: row.origin,
        reason: "definition",
        createQuery: stored,
      });
    }
    return conflicts;
  }

  private parameterNames(definition: LangWatchQLAppFunctionDefinition): readonly string[] {
    return definition.parameters.map((parameter) =>
      this.sqlText.assertIdentifier(parameter.name, "app function parameter"),
    );
  }

  private keyNames(definition: LangWatchQLAppFunctionDefinition): readonly string[] {
    return lwqlAppFunctionKeyParameters(definition).map((parameter) =>
      this.sqlText.assertIdentifier(parameter.name, "app function parameter"),
    );
  }
}

/**
 * The two spellings of one definition, written the same way: how much a server
 * rewrites before storing varies by version, so the comparison is insensitive
 * to exactly the places measurement shows they differ.
 */
function normaliseCreateQuery(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .replace(/-> tuple\(/, "-> (")
    .replace(/ AS \(([A-Za-z_][A-Za-z0-9_]*)\) ->/, " AS $1 ->")
    .trim();
}
