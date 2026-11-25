import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { tableOwnerMap } from "../src/tools/table-owners.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";

/**
 * @see specs/upgrade/release-manifests.feature
 */

const SCHEMA = `model Project {
  id String @id
}
model ProjectSetting {
  id String @id
  @@map("project_settings")
}
model Scratch {
  id String @id
}
`;

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "table-owners-"));
  roots.push(root);
  const write = (path: string, source: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  };
  write("packages/prisma-client/prisma/schema.prisma", SCHEMA);
  write(
    "modules/project/process/src/repositories/prisma/prisma.project.repository.ts",
    `import { prismaTables } from "@langwatch/prisma-client/ownership";
export class Repository { static readonly tables = prismaTables("Project", "ProjectSetting"); }
`,
  );
  write(
    "modules/trace/process/src/repositories/clickhouse/clickhouse.trace.repository.ts",
    `export async function store(client: { insert: (options: unknown) => Promise<void> }) {
  await client.insert({ table: "trace_summaries", values: [], format: "JSONEachRow" });
}
`,
  );
  write(
    "packages/clickhouse-migrations/migrations/00001_create_trace_summaries.sql",
    "-- +goose Up\nCREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries (TenantId String) ENGINE = MergeTree;\n",
  );
  write(
    "packages/clickhouse-migrations/migrations/00002_create_orphans.sql",
    "-- +goose Up\nCREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.orphans (TenantId String) ENGINE = MergeTree;\n",
  );
  const catalogue: FeatureCatalogueEntry[] = ["project", "trace"].map((id) => ({
    id,
    root: `modules/${id}`,
    classification: "core",
    subjects: [id],
  }));

  return { root, catalogue };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("tableOwnerMap", () => {
  /** @scenario "The release workflow reads each table's owner from the architecture enforcer" */
  it("maps owned Postgres and ClickHouse tables by their SQL names and leaves unowned ones out", () => {
    expect(tableOwnerMap(fixture())).toEqual({
      Project: "project",
      project_settings: "project",
      trace_summaries: "trace",
    });
  });
});
