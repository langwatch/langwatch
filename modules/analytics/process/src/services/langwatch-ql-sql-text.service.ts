/**
 * LangWatchQL analytics SQL — the identifier guard.
 * @see ../services/langwatch-ql-access-model.service.ts — the access model, as statements
 */
import { assertSafeIdentifier, quotedColumn } from "../rules/langwatch-ql-sql-literal.rules.ts";

export class LangWatchQLSqlTextService {
  static create(): LangWatchQLSqlTextService {
    return new LangWatchQLSqlTextService();
  }

  private constructor() {}

  /**
   * Returns `value` if it is a safe identifier, throws otherwise. `role` names what the
   * identifier is for, so a provisioning failure says which configured name was rejected rather
   * than only that one was.
   */
  assertIdentifier(value: string, role: string): string {
    return assertSafeIdentifier({ value, role });
  }

  /**
   * A PostgreSQL identifier as SQL: always double-quoted. Not optional the way it is on the
   * ClickHouse side.
   */
  postgresQuoted(value: string): string {
    return `"${this.assertIdentifier(value, "PostgreSQL identifier")}"`;
  }

  /** A column name as SQL: backtick-quoted, because it may carry dots. */
  quotedColumn(value: string): string {
    return quotedColumn(value);
  }
}
