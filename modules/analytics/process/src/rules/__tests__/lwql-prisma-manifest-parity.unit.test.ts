/** The committed Prisma manifest equals a fresh parse of `prisma/schema.prisma`. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LWQL_PRISMA_MANIFEST } from "../lwql-prisma-manifest.rules.ts";
import { parsePrismaSchema } from "../lwql-prisma-schema.rules.ts";

const SCHEMA_PATH = fileURLToPath(
  new URL("../../../../../../packages/prisma-client/prisma/schema.prisma", import.meta.url),
);

function freshParse() {
  return parsePrismaSchema(readFileSync(SCHEMA_PATH, "utf8"));
}

describe("given the committed Prisma manifest", () => {
  /** @scenario "The catalog ground truth lists every derived view" */
  it("equals a fresh parse of prisma/schema.prisma", () => {
    expect(
      LWQL_PRISMA_MANIFEST,
      "lwql-prisma-manifest.generated.json has drifted from the schema — " +
        "regenerate it with `pnpm generate:lwql-prisma-manifest`",
    ).toEqual(freshParse());
  });

  describe("its sanity floor", () => {
    const modelByName = new Map(LWQL_PRISMA_MANIFEST.models.map((model) => [model.name, model]));

    it("carries at least 100 models", () => {
      expect(LWQL_PRISMA_MANIFEST.models.length).toBeGreaterThanOrEqual(100);
    });

    it("carries Topic with its projectId/name/parentId fields", () => {
      const topic = modelByName.get("Topic");
      expect(topic).toBeDefined();
      const fieldNames = topic?.fields.map((field) => field.name) ?? [];
      expect(fieldNames).toEqual(expect.arrayContaining(["projectId", "name", "parentId"]));
    });

    it("reads Project's primary key as its id", () => {
      expect(modelByName.get("Project")?.primaryKey).toEqual(["id"]);
    });

    it("reads an @@map model's physical table name", () => {
      expect(modelByName.get("Dashboard")?.tableName).toBe("Dashboard");
    });

    it("reads a @map'd field's column name", () => {
      const projection = modelByName.get("LangyConversationProjection");
      const field = projection?.fields.find((entry) => entry.name === "ConversationId");
      expect(field?.columnName).toBe("conversationId");
    });
  });
});
