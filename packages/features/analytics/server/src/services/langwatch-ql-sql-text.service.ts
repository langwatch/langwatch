/**
 * LangWatchQL analytics SQL — the identifier guard.
 *
 * Every name a LangWatchQL statement interpolates comes from deployment
 * configuration rather than from a request, so an unsafe one is a programming
 * error and refusing is the only right answer. The escapers, which never
 * refuse, are `../rules/langwatch-ql-sql-literal.rules.ts`.
 *
 * @see ../services/langwatch-ql-access-model.service.ts — the access model, as statements
 */
import { SAFE_IDENTIFIER } from "../rules/langwatch-ql-sql-literal.rules";

/**
 * Column-name shape, which unlike a table name may carry dots.
 *
 * ClickHouse's nested columns are stored under dotted names
 * (`Messages.Content`), so a column identifier is validated more loosely than a
 * database or table one and is always backtick-quoted where it is emitted.
 */
const SAFE_COLUMN = /^[A-Za-z_][A-Za-z0-9_.]*$/;

export class LangWatchQLSqlTextService {
  static create(): LangWatchQLSqlTextService {
    return new LangWatchQLSqlTextService();
  }

  private constructor() {}

  /**
   * Returns `value` if it is a safe identifier, throws otherwise.
   *
   * `role` names what the identifier is for, so a provisioning failure says
   * which configured name was rejected rather than only that one was.
   */
  assertIdentifier(value: string, role: string): string {
    if (!SAFE_IDENTIFIER.test(value)) {
      throw new Error(`lwql: ${role} must match ${String(SAFE_IDENTIFIER)}, got "${value}"`);
    }

    return value;
  }

  /**
   * A PostgreSQL identifier as SQL: always double-quoted.
   *
   * Not optional the way it is on the ClickHouse side. Prisma names its tables
   * and columns in the case the model declares (`Annotation`, `projectId`), and
   * PostgreSQL folds an unquoted identifier to lower case, so an unquoted
   * `Annotation` resolves to a relation that does not exist. Every PostgreSQL
   * identifier this package emits goes through here — quoting some of them and
   * not others is the same bug, deferred until a deployment names a schema in
   * mixed case.
   */
  postgresQuoted(value: string): string {
    return `"${this.assertIdentifier(value, "PostgreSQL identifier")}"`;
  }

  /** A column name as SQL: backtick-quoted, because it may carry dots. */
  quotedColumn(value: string): string {
    if (!SAFE_COLUMN.test(value)) {
      throw new Error(`lwql: column must match ${String(SAFE_COLUMN)}, got "${value}"`);
    }

    return `\`${value}\``;
  }
}
