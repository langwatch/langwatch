import { describe, expect, it } from "vitest";
import {
  type Condition,
  operatorsForValueType,
  queryToConditions,
  serializeConditions,
} from "../conditionQuery";

/** Build a condition without the noise of an id in every test. */
function cond(partial: Omit<Condition, "id"> & { id?: string }): Condition {
  return { id: "c0", ...partial };
}

describe("serializeConditions", () => {
  describe("given a single membership condition", () => {
    it("emits field:value for is", () => {
      expect(
        serializeConditions([cond({ field: "status", operator: "is", value: "error" })]),
      ).toBe("status:error");
    });

    it("emits -field:value for is_not", () => {
      expect(
        serializeConditions([cond({ field: "status", operator: "is_not", value: "error" })]),
      ).toBe("-status:error");
    });

    it("quotes a value that contains a space", () => {
      expect(
        serializeConditions([cond({ field: "user", operator: "is", value: "acme corp" })]),
      ).toBe('user:"acme corp"');
    });

    it("leaves a wildcard value bare", () => {
      expect(
        serializeConditions([cond({ field: "model", operator: "is", value: "gpt-4o*" })]),
      ).toBe("model:gpt-4o*");
    });
  });

  describe("given range conditions", () => {
    it("emits comparators", () => {
      expect(
        serializeConditions([cond({ field: "cost", operator: "gt", value: "0.1" })]),
      ).toBe("cost:>0.1");
      expect(
        serializeConditions([cond({ field: "cost", operator: "lte", value: "1" })]),
      ).toBe("cost:<=1");
    });

    it("emits a bracketed range for between", () => {
      expect(
        serializeConditions([
          cond({ field: "cost", operator: "between", value: "0.1", valueTo: "1" }),
        ]),
      ).toBe("cost:[0.1 TO 1]");
    });
  });

  describe("given several conditions", () => {
    it("joins them with AND", () => {
      expect(
        serializeConditions([
          cond({ id: "a", field: "status", operator: "is", value: "error" }),
          cond({ id: "b", field: "model", operator: "is", value: "gpt-4o" }),
        ]),
      ).toBe("status:error AND model:gpt-4o");
    });
  });

  describe("given an incomplete row", () => {
    it("skips a row whose value is blank", () => {
      expect(
        serializeConditions([
          cond({ id: "a", field: "status", operator: "is", value: "error" }),
          cond({ id: "b", field: "model", operator: "is", value: "" }),
        ]),
      ).toBe("status:error");
    });

    it("skips a between row missing its upper bound", () => {
      expect(
        serializeConditions([
          cond({ field: "cost", operator: "between", value: "0.1", valueTo: "" }),
        ]),
      ).toBe("");
    });
  });
});

describe("queryToConditions", () => {
  describe("given an empty query", () => {
    it("returns an empty row list, not null", () => {
      expect(queryToConditions("")).toEqual([]);
      expect(queryToConditions("   ")).toEqual([]);
    });
  });

  describe("given a simple AND chain", () => {
    it("parses each clause into a condition", () => {
      const conditions = queryToConditions("status:error AND model:gpt-4o");
      expect(conditions).toEqual([
        { id: "c0", field: "status", operator: "is", value: "error" },
        { id: "c1", field: "model", operator: "is", value: "gpt-4o" },
      ]);
    });

    it("reads a negated clause as is_not", () => {
      expect(queryToConditions("-status:error")).toEqual([
        { id: "c0", field: "status", operator: "is_not", value: "error" },
      ]);
      expect(queryToConditions("NOT status:error")).toEqual([
        { id: "c0", field: "status", operator: "is_not", value: "error" },
      ]);
    });

    it("reads comparators and ranges", () => {
      expect(queryToConditions("cost:>0.1")).toEqual([
        { id: "c0", field: "cost", operator: "gt", value: "0.1" },
      ]);
      expect(queryToConditions("cost:[0.1 TO 1]")).toEqual([
        { id: "c0", field: "cost", operator: "between", value: "0.1", valueTo: "1" },
      ]);
    });

    it("unquotes a quoted value", () => {
      expect(queryToConditions('user:"acme corp"')).toEqual([
        { id: "c0", field: "user", operator: "is", value: "acme corp" },
      ]);
    });
  });

  describe("given a query richer than the builder can represent", () => {
    it("returns null for an OR", () => {
      expect(queryToConditions("status:error OR status:warning")).toBeNull();
    });

    it("returns null for free text", () => {
      expect(queryToConditions("refund policy")).toBeNull();
    });

    it("returns null for an exclusive range", () => {
      expect(queryToConditions("cost:{0.1 TO 1}")).toBeNull();
    });

    it("returns null for invalid syntax", () => {
      expect(queryToConditions('status:"unterminated')).toBeNull();
    });
  });

  describe("round-trip", () => {
    it("survives builder → string → builder unchanged", () => {
      const conditions: Condition[] = [
        { id: "c0", field: "status", operator: "is", value: "error" },
        { id: "c1", field: "cost", operator: "between", value: "0.1", valueTo: "1" },
        { id: "c2", field: "user", operator: "is_not", value: "acme corp" },
      ];
      const query = serializeConditions(conditions);
      expect(queryToConditions(query)).toEqual(conditions);
    });
  });
});

describe("operatorsForValueType", () => {
  it("offers comparators for range fields", () => {
    expect(operatorsForValueType("range")).toContain("between");
    expect(operatorsForValueType("range")).not.toContain("is");
  });

  it("offers membership for everything else", () => {
    expect(operatorsForValueType("categorical")).toEqual(["is", "is_not"]);
    expect(operatorsForValueType(undefined)).toEqual(["is", "is_not"]);
  });
});
