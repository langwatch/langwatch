import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { functionFitsScopes, pageOf, rangeOf } from "../staff-access-function.rules.ts";

const at = Temporal.Instant.from("2026-11-02T10:00:00Z");

describe("functionFitsScopes", () => {
  it("lets ops:read reach lookups and an org scope reach org functions, never across", () => {
    expect(functionFitsScopes({ name: "orgs.find", scopes: ["ops:read"] })).toBe(true);
    expect(functionFitsScopes({ name: "orgs.find", scopes: ["org:metadata"] })).toBe(false);
    expect(functionFitsScopes({ name: "org.snapshot", scopes: ["org:metadata"] })).toBe(true);
    expect(functionFitsScopes({ name: "org.snapshot", scopes: ["ops:read"] })).toBe(false);
  });

  it("never lets a copy side reach an org function", () => {
    expect(functionFitsScopes({ name: "org.api_keys", scopes: ["copy:source"] })).toBe(false);
    expect(functionFitsScopes({ name: "org.api_keys", scopes: ["copy:target"] })).toBe(false);
    expect(functionFitsScopes({ name: "org.api_keys", scopes: ["org:metadata"] })).toBe(true);
  });
});

describe("rangeOf", () => {
  it("defaults the end to now and accepts 31 days", () => {
    const range = rangeOf({ since: "2026-10-02T10:00:00Z", at });
    expect(range.until.toString()).toBe(at.toString());
  });

  it("refuses 32 days and a range that ends before it starts", () => {
    const code = (run: () => unknown) => {
      try {
        run();
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    expect(code(() => rangeOf({ since: "2026-10-01T09:00:00Z", at }))).toBe(
      "staff_function_bad_input",
    );
    expect(
      code(() => rangeOf({ since: "2026-11-02T10:00:00Z", until: "2026-11-01T10:00:00Z", at })),
    ).toBe("staff_function_bad_input");
  });
});

describe("pageOf", () => {
  const rows = ["c", "a", "b"].map((id) => ({ id }));

  it("pages in key order with a cursor that reads on and never repeats a row", () => {
    const first = pageOf({ rows, keyOf: (row) => row.id, limit: 2, name: "fn" });
    expect(first).toMatchObject({ total: 3, truncated: true, items: [{ id: "a" }, { id: "b" }] });

    const rest = pageOf({
      rows: [...rows, { id: "0" }],
      keyOf: (row) => row.id,
      limit: 2,
      cursor: first.nextCursor ?? "",
      name: "fn",
    });
    expect(rest).toMatchObject({ truncated: false, nextCursor: null, items: [{ id: "c" }] });
  });

  it("refuses a cursor another function handed out", () => {
    const first = pageOf({ rows, keyOf: (row) => row.id, limit: 1, name: "fn" });
    expect(() =>
      pageOf({ rows, keyOf: (row) => row.id, cursor: first.nextCursor ?? "", name: "other" }),
    ).toThrow(expect.objectContaining({ code: "staff_function_bad_cursor" }));
  });
});
