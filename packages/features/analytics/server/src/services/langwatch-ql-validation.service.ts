/**
 * LangWatchQL analytics SQL — the default-deny AST validator.
 * @see specs/analytics/lwql-api.feature
 * @see dev/docs/adr/081-lwql-table-function-and-ssrf-policy.md
 */
import {
  clickHouseSqlParser,
  type LangWatchQLParser,
  type SqlAstNode,
  type SqlSourcePosition,
} from "../rules/langwatch-ql-parser.rules";
import {
  type LangWatchQLPolicy,
  qualifyTableName,
  RESERVED_DATABASES,
  type ResolvedLangWatchQLPolicy,
  DEFAULT_LWQL_LIMITS,
} from "../rules/langwatch-ql-policy.rules";
import { positionOf, ROOT_FRAME, walkNode } from "../rules/langwatch-ql-query-walk.rules";
import type {
  LangWatchQLValidation,
  RejectedLangWatchQL,
  WalkContext,
} from "../rules/langwatch-ql-validation-shape.rules";
import type { LangWatchQLViolationCode } from "../rules/langwatch-ql-violations.rules";

export interface ValidateLangWatchQLInput extends LangWatchQLPolicy {
  /** The SQL exactly as the caller submitted it. Never rewritten. */
  readonly sql: string;
}

/** What the walk was handed, or the rejection that replaces it. */
type ScreenedSubmission = { statement: SqlAstNode } | RejectedLangWatchQL;

/**
 * Decides whether a submitted query may be executed against the LangWatchQL analytics schema.
 * @example
 */
export class LangWatchQLValidationService {
  private constructor(private readonly parser: LangWatchQLParser) {}

  /**
   * @param parser The SQL front end. Defaults to the shipped ClickHouse
   *   parser; injected only by tests that need to drive the walk with a tree
   *   the grammar cannot produce.
   */
  static create({
    parser = clickHouseSqlParser,
  }: { parser?: LangWatchQLParser } = {}): LangWatchQLValidationService {
    return new LangWatchQLValidationService(parser);
  }

  validate({ sql, ...policy }: ValidateLangWatchQLInput): LangWatchQLValidation {
    const screened = this.screenSubmission(sql);
    if ("ok" in screened) {
      return screened;
    }

    const ctx = this.createWalkContext(this.resolvePolicy(policy));
    walkNode(screened.statement, ROOT_FRAME, ctx);

    if (ctx.violations.length > 0) {
      return { ok: false, violations: ctx.violations };
    }

    return {
      ok: true,
      tables: [...ctx.tables],
      parameters: ctx.parameters.map(({ name, type }) => ({ name, type })),
      blocks: ctx.blocks.map((block) => ({
        tables: [...block.tables],
        joins: [...block.joins],
        filteredColumns: [...block.filteredColumns],
        groupByColumns: [...block.groupByColumns],
        hasGroupBy: block.hasGroupBy,
        isAggregated: block.isAggregated,
      })),
    };
  }

  /** Normalises a policy once, before the walk. */
  private resolvePolicy(policy: LangWatchQLPolicy): ResolvedLangWatchQLPolicy {
    const defaultDatabase = policy.defaultDatabase?.trim().toLowerCase() ?? "";

    return {
      allowedTables: new Set(
        policy.allowedTables.map((entry) => qualifyTableName({ table: entry, defaultDatabase })),
      ),
      gatedColumns: new Set(policy.gatedColumns.map((column) => column.trim().toLowerCase())),
      reservedDatabases: new Set(RESERVED_DATABASES),
      defaultDatabase,
      limits: policy.limits ?? DEFAULT_LWQL_LIMITS,
    };
  }

  private createWalkContext(policy: ResolvedLangWatchQLPolicy): WalkContext {
    return {
      policy,
      violations: [],
      tables: [],
      parameters: [],
      blocks: [],
    };
  }

  /**
   * Everything decided before the walk: that the text parses, that it is
   * exactly one statement, and that the statement is a read query.
   */
  private screenSubmission(sql: string): ScreenedSubmission {
    const parsed = this.parseOrRefuse(sql);
    if (!parsed.ok) {
      return this.statementRejection({
        code: "PARSE_FAILED",
        message: "This is not valid ClickHouse SQL. Check the syntax and try again.",
        at: parsed.at,
      });
    }

    if (parsed.statements.length > 1) {
      return this.statementRejection({
        code: "MULTIPLE_STATEMENTS",
        message: "Only one statement can be submitted at a time. Send a single SELECT statement.",
      });
    }

    const statement = parsed.statements[0];
    if (statement === undefined) {
      return this.statementRejection({
        code: "EMPTY_QUERY",
        message: "No query was submitted. Send a single SELECT statement.",
      });
    }

    if (statement.type !== "SelectWithUnionQuery") {
      return this.statementRejection({
        code: "STATEMENT_NOT_ALLOWED",
        message:
          "Only a single SELECT statement, optionally with a WITH clause, can be submitted here.",
        at: positionOf(statement),
      });
    }

    return { statement };
  }

  private parseOrRefuse(sql: string): ReturnType<LangWatchQLParser["parse"]> {
    try {
      return this.parser.parse(sql);
    } catch {
      return { ok: false };
    }
  }

  /** A rejection carrying one statement-level reason. */
  private statementRejection({
    code,
    message,
    at,
  }: {
    code: LangWatchQLViolationCode;
    message: string;
    at?: SqlSourcePosition;
  }): RejectedLangWatchQL {
    return {
      ok: false,
      violations: [{ code, clause: "statement", message, ...(at ? { at } : {}) }],
    };
  }
}
