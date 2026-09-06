import { describe, expect, it } from "vitest";
import { postgresReaderStatementsFor } from "../postgresReaderProvisioning";

describe("postgresReaderStatementsFor", () => {
  describe("when mode is manage-role", () => {
    it("returns full reader role statements when password is provided", () => {
      const result = postgresReaderStatementsFor({
        mode: "manage-role",
        readerPassword: "secret123",
        schema: "public",
      });

      expect(result.statements.length).toBeGreaterThan(0);
      expect(result.warningMessage).toBeUndefined();
      // Should contain reader role setup (from selfHostedPostgresReaderStatements)
      // which includes role creation and grants
      expect(result.statements.some((s) => s.includes("CREATE ROLE"))).toBe(
        true,
      );
    });

    it("returns grant-only statements and warning when password is missing", () => {
      const result = postgresReaderStatementsFor({
        mode: "manage-role",
        readerPassword: undefined,
        schema: "public",
      });

      expect(result.statements.length).toBeGreaterThan(0);
      expect(result.warningMessage).toBe(
        "LWQL_MANAGE_POSTGRES_READER is true but LWQL_POSTGRES_READER_PASSWORD is not set — cannot converge the reader role this boot; re-granting the approved views only",
      );
      // Should contain grants only (from productionPostgresReaderGrantStatements)
      expect(result.statements[0]).toContain("DO $$");
      expect(result.statements[0]).toContain("GRANT");
    });
  });

  describe("when mode is grants-only", () => {
    it("returns grant-only statements without warning", () => {
      const result = postgresReaderStatementsFor({
        mode: "grants-only",
        readerPassword: "secret123",
        schema: "public",
        role: "lwql_ro",
      });

      expect(result.statements.length).toBeGreaterThan(0);
      expect(result.warningMessage).toBeUndefined();
      // Should contain grants only (from productionPostgresReaderGrantStatements)
      expect(result.statements[0]).toContain("DO $$");
      expect(result.statements[0]).toContain("GRANT");
    });

    it("returns grant-only statements when password is absent", () => {
      const result = postgresReaderStatementsFor({
        mode: "grants-only",
        readerPassword: undefined,
        schema: "public",
        role: "lwql_ro",
      });

      expect(result.statements.length).toBeGreaterThan(0);
      expect(result.warningMessage).toBeUndefined();
      // Should contain grants only
      expect(result.statements[0]).toContain("DO $$");
      expect(result.statements[0]).toContain("GRANT");
    });
  });

  describe("schema and role parameters", () => {
    it("uses custom schema in statements", () => {
      const result = postgresReaderStatementsFor({
        mode: "grants-only",
        schema: "custom_schema",
        role: "custom_role",
      });

      expect(result.statements[0]).toContain("custom_schema");
      expect(result.statements[0]).toContain("custom_role");
    });

    it("uses default schema when not provided", () => {
      const result = postgresReaderStatementsFor({
        mode: "grants-only",
      });

      expect(result.statements.length).toBeGreaterThan(0);
      // Should have some statements (even if they reference default schema)
      expect(result.statements[0]).toBeDefined();
    });
  });
});
