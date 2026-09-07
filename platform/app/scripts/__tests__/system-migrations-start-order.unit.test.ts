import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("start.sh system migration ordering", () => {
  it("runs system migrations after schemas and before constructing runtime lanes", () => {
    const source = readFileSync(
      new URL("../start.sh", import.meta.url),
      "utf8",
    );
    const schemaMigrations = source.indexOf("pnpm run start:prepare:db");
    const systemMigrations = source.indexOf("pnpm run task system-migrations");
    const runtimeLanes = source.indexOf("COMMANDS=()");

    expect(source).toContain("set -eo pipefail");
    expect(schemaMigrations).toBeGreaterThan(-1);
    expect(systemMigrations).toBeGreaterThan(schemaMigrations);
    expect(runtimeLanes).toBeGreaterThan(systemMigrations);
  });
});
