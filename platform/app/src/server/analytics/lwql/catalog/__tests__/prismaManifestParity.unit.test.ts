/**
 * The committed Prisma manifest equals a fresh parse of `prisma/schema.prisma`.
 *
 * `prismaManifest.generated.json` is what the Postgres catalog derivation reads
 * for every model/field fact, and it is generated — never hand-edited. This
 * proof is what stops it drifting: it re-parses the schema with the very parser
 * the generator calls and asserts the committed file equals that parse. A schema
 * change that adds, drops or retypes a field is therefore a red test here until
 * `pnpm generate:lwql-prisma-manifest` is re-run.
 *
 * Unlike the ClickHouse columns-manifest parity test, this one is pure text —
 * no database, no container — so it is a unit test.
 *
 * @see ../prismaManifest.ts — the committed manifest and its accessors
 * @see ../../../../../scripts/generate-lwql-prisma-manifest.ts — the generator
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LWQL_PRISMA_MANIFEST } from "../prismaManifest";
import { parsePrismaSchema } from "../prismaSchema";

function freshParse() {
  const schema = readFileSync(
    resolve(process.cwd(), "prisma/schema.prisma"),
    "utf8",
  );
  return parsePrismaSchema(schema);
}

describe("given the committed Prisma manifest", () => {
  /** @scenario "The catalog ground truth lists every derived view" */
  it("equals a fresh parse of prisma/schema.prisma", () => {
    expect(
      LWQL_PRISMA_MANIFEST,
      "prismaManifest.generated.json has drifted from the schema — " +
        "regenerate it with `pnpm generate:lwql-prisma-manifest`",
    ).toEqual(freshParse());
  });

  describe("its sanity floor", () => {
    const modelByName = new Map(
      LWQL_PRISMA_MANIFEST.models.map((model) => [model.name, model]),
    );

    it("carries at least 100 models", () => {
      expect(LWQL_PRISMA_MANIFEST.models.length).toBeGreaterThanOrEqual(100);
    });

    it("carries Topic with its projectId/name/parentId fields", () => {
      const topic = modelByName.get("Topic");
      expect(topic).toBeDefined();
      const fieldNames = topic?.fields.map((field) => field.name) ?? [];
      expect(fieldNames).toEqual(
        expect.arrayContaining(["projectId", "name", "parentId"]),
      );
    });

    it("reads Project's primary key as its id", () => {
      expect(modelByName.get("Project")?.primaryKey).toEqual(["id"]);
    });

    it("reads an @@map model's physical table name", () => {
      expect(modelByName.get("Dashboard")?.tableName).toBe("Dashboard");
    });

    it("reads a @map'd field's column name", () => {
      const projection = modelByName.get("LangyConversationProjection");
      const field = projection?.fields.find(
        (entry) => entry.name === "ConversationId",
      );
      expect(field?.columnName).toBe("conversationId");
    });
  });
});
