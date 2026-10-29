/**
 * The id index retention raise's parameters: one statement per index and target, split only past
 * the URL budget. Spec: specs/clickhouse/id-index-reads.feature
 */
import { describe, expect, it } from "vitest";

import { idIndexRaiseParamBytes, idIndexRetentionRaises } from "../idIndexRetention.ts";

describe("idIndexRetentionRaises", () => {
  describe("given tenants of differing retention", () => {
    /** @scenario "a retention raise is one statement per index, never lowering a row" */
    it("binds every tenant to its own days in one raise, a source's 0 as kept forever", () => {
      const raises = idIndexRetentionRaises({
        daysByTenant: new Map([
          ["project-b", 30],
          ["project-a", 0],
          ["project-c", 365],
        ]),
      });

      expect(raises).toEqual([
        {
          tenantIds: ["project-a", "project-b", "project-c"],
          retentionDays: [65_535, 30, 365],
        },
      ]);
    });
  });

  describe("given more tenant ids than one URL carries", () => {
    it("splits the raise only at the byte budget, not per retention value", () => {
      const daysByTenant = new Map(
        Array.from({ length: 30 }, (_, at) => [`project-${String(at).padStart(2, "0")}`, at % 3]),
      );

      const raises = idIndexRetentionRaises({ daysByTenant, paramBytes: 200 });

      expect(raises.map((each) => each.tenantIds.length)).toEqual([10, 10, 10]);
      expect(idIndexRetentionRaises({ daysByTenant })).toHaveLength(1);
    });
  });

  describe("given a target with tens of thousands of tenants", () => {
    /** ClickHouse's default `http_max_field_value_size`: one URL field's value, at most. */
    const MAX_FIELD_VALUE_BYTES = 128 * 1024;

    /** One parameter as `@clickhouse/client` puts it in the URL: an array literal, encoded. */
    const urlField = (name: string, values: readonly (string | number)[]): number => {
      const literal = `[${values
        .map((value) =>
          typeof value === "number"
            ? String(value)
            : `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\t/g, "\\t")}'`,
        )
        .join(",")}]`;
      return new URLSearchParams([[`param_${name}`, literal]]).toString().length;
    };

    const daysByTenant = new Map(
      Array.from({ length: 20_000 }, (_, at) => [
        `project_${String(at).padStart(21, "x")}`,
        [0, 30, 365][at % 3] ?? 30,
      ]),
    );

    it("keeps every raise's tenant ids under one URL field's cap", () => {
      const raises = idIndexRetentionRaises({ daysByTenant });

      expect(raises.length).toBeGreaterThan(1);
      expect(raises.flatMap((each) => each.tenantIds)).toHaveLength(daysByTenant.size);
      for (const raise of raises) {
        expect(urlField("tenantIds", raise.tenantIds)).toBeLessThan(MAX_FIELD_VALUE_BYTES);
        expect(urlField("retentionDays", raise.retentionDays)).toBeLessThan(MAX_FIELD_VALUE_BYTES);
      }
    });

    it("keeps ids full of quotes and backslashes under the cap, sized as the client escapes them", () => {
      const escapeHeavy = new Map(
        Array.from({ length: 6_000 }, (_, at) => [
          `${at % 2 === 0 ? "'".repeat(20) : "\\".repeat(20)}\t${String(at).padStart(8, "0")}`,
          30,
        ]),
      );

      const raises = idIndexRetentionRaises({ daysByTenant: escapeHeavy });

      expect(raises.flatMap((each) => each.tenantIds)).toHaveLength(escapeHeavy.size);
      for (const raise of raises) {
        expect(urlField("tenantIds", raise.tenantIds)).toBeLessThan(MAX_FIELD_VALUE_BYTES);
      }
      const [id] = escapeHeavy.keys();
      expect(idIndexRaiseParamBytes(id!)).toBe(
        urlField("tenantIds", [id!, id!]) - urlField("tenantIds", [id!]),
      );
    });

    it("refuses a single id that no raise can carry", () => {
      expect(() =>
        idIndexRetentionRaises({
          daysByTenant: new Map([["'".repeat(30), 30]]),
          paramBytes: 100,
        }),
      ).toThrow(/cannot fit/);
    });

    it("would pass the field cap at the old 512 KiB budget", () => {
      const [first] = idIndexRetentionRaises({
        daysByTenant,
        paramBytes: 512 * 1024,
      });

      expect(urlField("tenantIds", first?.tenantIds ?? [])).toBeGreaterThan(MAX_FIELD_VALUE_BYTES);
    });
  });
});
