/** The Postgres catalog builder's type mapping: Prisma type → ClickHouse type. */

import { describe, expect, it } from "vitest";

import { toClickHouseType } from "../lwql-postgres-catalog-model.rules.ts";
import type { PrismaField } from "../lwql-prisma-schema.rules.ts";

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

describe("given the Postgres catalog type mapping", () => {
  describe("when a Prisma type becomes a ClickHouse type", () => {
    it("maps each scalar, wraps lists and optionals, strips binary", () => {
      expect(toClickHouseType(scalarField({ type: "String" }))).toBe("String");
      expect(toClickHouseType(scalarField({ type: "Int" }))).toBe("Int32");
      expect(toClickHouseType(scalarField({ type: "BigInt" }))).toBe("Int64");
      expect(toClickHouseType(scalarField({ type: "Float" }))).toBe("Float64");
      expect(toClickHouseType(scalarField({ type: "Boolean" }))).toBe("Bool");
      expect(toClickHouseType(scalarField({ type: "DateTime" }))).toBe("DateTime64(3)");
      expect(toClickHouseType(scalarField({ type: "Json" }))).toBe("String");
      expect(toClickHouseType(scalarField({ kind: "enum", type: "MyEnum" }))).toBe("String");
      expect(
        toClickHouseType(
          scalarField({
            type: "Decimal",
            decimal: { precision: 10, scale: 2 },
          }),
        ),
      ).toBe("Decimal(10, 2)");
      expect(toClickHouseType(scalarField({ type: "Decimal" }))).toBe("Decimal(65, 30)");
      expect(toClickHouseType(scalarField({ type: "String", isOptional: true }))).toBe(
        "Nullable(String)",
      );
      expect(toClickHouseType(scalarField({ type: "String", isList: true }))).toBe("Array(String)");
      expect(toClickHouseType(scalarField({ type: "Bytes" }))).toBeNull();
      expect(toClickHouseType(scalarField({ kind: "unsupported", type: "geo" }))).toBeNull();
    });
  });
});
