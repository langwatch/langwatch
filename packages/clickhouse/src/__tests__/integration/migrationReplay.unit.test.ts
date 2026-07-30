import { describe, expect, it } from "vitest";
import { extractTableStatementsFromFiles } from "./migrationReplay.js";

/**
 * `extractTableStatementsFromFiles` is the pure core `extractTableStatements`
 * wraps around real migration files — these tests exercise it against small,
 * synthetic goose-shaped fixtures rather than the real migrations directory,
 * so the extraction rules are pinned independently of any one migration's
 * current content.
 */

function files(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe("given a migration file with one CREATE TABLE for the target table", () => {
  /** @scenario a statement whose keyword and table name match is extracted */
  it("extracts the statement verbatim", () => {
    const sql = `-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.widgets
(
    Id String
)
ENGINE = MergeTree;
-- +goose StatementEnd
`;
    const statements = extractTableStatementsFromFiles(
      files({ "00001_create_widgets.sql": sql }),
      "widgets",
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("CREATE TABLE IF NOT EXISTS widgets");
    expect(statements[0]).toContain("ENGINE = MergeTree");
  });
});

describe("given a migration file whose CREATE TABLE names a different table", () => {
  /** @scenario a comment mentioning the table elsewhere is not mistaken for a statement targeting it */
  it("extracts nothing, even when a comment mentions the target table by name", () => {
    const sql = `-- +goose Up
-- Widgets are related to gadgets, see the gadgets table.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.gadgets
(
    Id String
)
ENGINE = MergeTree;
-- +goose StatementEnd
`;
    const statements = extractTableStatementsFromFiles(
      files({ "00001_create_gadgets.sql": sql }),
      "widgets",
    );

    expect(statements).toEqual([]);
  });
});

describe("given a statement inside a commented-out Down block", () => {
  /** @scenario a statement in a commented-out Down block is never extracted */
  it("is never extracted, even though it names the target table", () => {
    const sql = `-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.widgets
(
    Id String
)
ENGINE = MergeTree;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- DROP TABLE IF EXISTS \${CLICKHOUSE_DATABASE}.widgets;
-- +goose StatementEnd
`;
    const statements = extractTableStatementsFromFiles(
      files({ "00001_create_widgets.sql": sql }),
      "widgets",
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("CREATE TABLE");
    expect(statements.some((statement) => statement.includes("DROP"))).toBe(
      false,
    );
  });
});

describe("given a CREATE TABLE in one file and an ALTER TABLE for the same table in a later file", () => {
  /** @scenario a later migration's ALTER TABLE on the same table is extracted after its CREATE TABLE */
  it("extracts both, in file order", () => {
    const create = `-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.widgets
(
    Id String
)
ENGINE = MergeTree;
-- +goose StatementEnd
`;
    const alter = `-- +goose Up
-- +goose StatementBegin
ALTER TABLE \${CLICKHOUSE_DATABASE}.widgets ADD COLUMN Name String;
-- +goose StatementEnd
`;
    const statements = extractTableStatementsFromFiles(
      files({
        "00001_create_widgets.sql": create,
        "00002_add_widgets_name.sql": alter,
      }),
      "widgets",
    );

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TABLE");
    expect(statements[1]).toContain("ALTER TABLE");
  });
});

describe("given a CREATE TABLE with no database qualifier", () => {
  /** @scenario the unqualified stored_objects spelling is still recognised */
  it("still extracts it, matching migration 00023's deliberately unqualified stored_objects", () => {
    const sql = `-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS stored_objects
(
    id String
)
ENGINE = ReplacingMergeTree(inserted_at);
-- +goose StatementEnd
`;
    const statements = extractTableStatementsFromFiles(
      files({ "00023_create_stored_objects.sql": sql }),
      "stored_objects",
    );

    expect(statements).toHaveLength(1);
  });
});

describe("given the env var placeholders the deployed migrations write", () => {
  /** @scenario known env var placeholders resolve to their local, non-clustered defaults */
  it("resolves the database qualifier, the replacing-engine prefix and the storage policy setting", () => {
    const sql = `-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.widgets
(
    Id String
)
ENGINE = \${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}Id)
SETTINGS index_granularity = 8192\${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd
`;
    const [statement] = extractTableStatementsFromFiles(
      files({ "00001_create_widgets.sql": sql }),
      "widgets",
    );

    expect(statement).toContain("CREATE TABLE IF NOT EXISTS widgets");
    expect(statement).toContain("ENGINE = ReplacingMergeTree(Id)");
    expect(statement).toContain("SETTINGS index_granularity = 8192;");
    expect(statement).not.toContain("${");
  });
});
