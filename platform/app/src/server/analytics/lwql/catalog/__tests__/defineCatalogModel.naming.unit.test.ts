/**
 * The Postgres catalog derivation's naming and type-mapping helpers: model
 * name → view name, field name → column name, Prisma type → ClickHouse type.
 *
 * Split out of `./derivePostgresCatalog.unit.test.ts` (which covers tenant
 * scope, safe defaults and overrides) to keep each file under the repo's
 * per-file line budget for new test files.
 *
 * @see ../derivePostgresCatalog.ts — the code under test
 */

import { describe, expect, it } from "vitest";
import {
  clickHouseTypeFor,
  exposedColumnName,
  postgresDatasetName,
} from "../derivePostgresCatalog";
import type { PrismaField } from "../prismaSchema";

const scalarField = (over: Partial<PrismaField>): PrismaField => ({
  name: "f",
  columnName: "f",
  type: "String",
  kind: "scalar",
  isList: false,
  isOptional: false,
  documentation: "",
  ...over,
});

describe("given the Postgres catalog naming helpers", () => {
  describe("when a model name becomes a view name", () => {
    it("snake-cases acronym-aware and pluralises the last word", () => {
      expect(postgresDatasetName("CustomLLMModelCost")).toBe(
        "custom_llm_model_costs",
      );
      expect(postgresDatasetName("Topic")).toBe("topics");
      expect(postgresDatasetName("RoutingPolicy")).toBe("routing_policies");
      expect(postgresDatasetName("Analytics")).toBe("analytics");
      expect(postgresDatasetName("AnnotationQueue")).toBe("annotation_queues");
    });
  });

  describe("when a field name becomes a column name", () => {
    it("maps the primary key `id` to `<Model>Id` and PascalCases the rest", () => {
      expect(
        exposedColumnName({
          modelName: "Topic",
          fieldName: "id",
          primaryKey: ["id"],
        }),
      ).toBe("TopicId");
      expect(
        exposedColumnName({
          modelName: "Topic",
          fieldName: "embeddings_model",
          primaryKey: ["id"],
        }),
      ).toBe("EmbeddingsModel");
      expect(
        exposedColumnName({
          modelName: "Topic",
          fieldName: "p95Distance",
          primaryKey: ["id"],
        }),
      ).toBe("P95Distance");
    });
  });

  describe("when a Prisma type becomes a ClickHouse type", () => {
    it("maps each scalar, wraps lists and optionals, strips binary", () => {
      expect(clickHouseTypeFor(scalarField({ type: "String" }))).toBe("String");
      expect(clickHouseTypeFor(scalarField({ type: "Int" }))).toBe("Int32");
      expect(clickHouseTypeFor(scalarField({ type: "BigInt" }))).toBe("Int64");
      expect(clickHouseTypeFor(scalarField({ type: "Float" }))).toBe("Float64");
      expect(clickHouseTypeFor(scalarField({ type: "Boolean" }))).toBe("Bool");
      expect(clickHouseTypeFor(scalarField({ type: "DateTime" }))).toBe(
        "DateTime64(3)",
      );
      expect(clickHouseTypeFor(scalarField({ type: "Json" }))).toBe("String");
      expect(
        clickHouseTypeFor(scalarField({ kind: "enum", type: "MyEnum" })),
      ).toBe("String");
      expect(
        clickHouseTypeFor(
          scalarField({
            type: "Decimal",
            decimal: { precision: 10, scale: 2 },
          }),
        ),
      ).toBe("Decimal(10, 2)");
      expect(clickHouseTypeFor(scalarField({ type: "Decimal" }))).toBe(
        "Decimal(65, 30)",
      );
      expect(
        clickHouseTypeFor(scalarField({ type: "String", isOptional: true })),
      ).toBe("Nullable(String)");
      expect(
        clickHouseTypeFor(scalarField({ type: "String", isList: true })),
      ).toBe("Array(String)");
      expect(clickHouseTypeFor(scalarField({ type: "Bytes" }))).toBeNull();
      expect(
        clickHouseTypeFor(scalarField({ kind: "unsupported", type: "geo" })),
      ).toBeNull();
    });
  });
});
