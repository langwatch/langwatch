import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ClickHouse migrations", () => {
  /** @scenario Retention schema migration versions are unique */
  it("uses unique numeric migration versions", () => {
    const migrationDir = resolve(
      process.cwd(),
      "src/server/clickhouse/migrations",
    );
    const versions = readdirSync(migrationDir)
      .map((file) => file.match(/^(\d+)_.*\.sql$/)?.[1])
      .filter((version): version is string => version != null);

    const duplicates = versions.filter(
      (version, index) => versions.indexOf(version) !== index,
    );

    expect(duplicates).toEqual([]);
  });
});
