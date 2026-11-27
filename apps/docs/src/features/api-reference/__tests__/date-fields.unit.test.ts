import { describe, expect, it } from "vitest";

import { fieldOf, paramFieldOf } from "../model/body-form.ts";

const EITHER = "Epoch milliseconds, or an ISO 8601 date string.";

describe("when a date accepts epoch milliseconds or a date string", () => {
  it("offers a date picker for a body field typed number or string", () => {
    const field = fieldOf({
      name: "startDate",
      schema: { type: ["number", "string"], description: EITHER },
      path: ["startDate"],
      required: true,
    });
    expect(field.kind).toBe("epoch-ms");
  });

  it("offers a date picker for an anyOf of number and string", () => {
    const field = fieldOf({
      name: "endDate",
      schema: { anyOf: [{ type: "number" }, { type: "string" }], description: EITHER },
      path: ["endDate"],
      required: true,
    });
    expect(field.kind).toBe("epoch-ms");
  });

  it("reads a query parameter's own description when its schema has none", () => {
    const field = paramFieldOf({
      name: "startDate",
      schema: { type: "string" },
      required: false,
      description: EITHER,
    });
    expect(field.kind).toBe("date-time");
  });

  it("keeps a plain number or string field a text box", () => {
    const field = fieldOf({
      name: "startDate",
      schema: { type: ["number", "string"] },
      path: ["startDate"],
      required: true,
    });
    expect(field.kind).toBe("text");
  });
});
