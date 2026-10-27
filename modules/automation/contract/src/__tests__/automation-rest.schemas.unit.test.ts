import { describe, expect, it } from "vitest";

import {
  automationRestFiresQuerySchema,
  encodeTriggerFireCursor,
} from "../automation-rest.schemas.ts";

describe("the trigger fire cursor", () => {
  it("decodes what it encodes", () => {
    const cursor = { createdAt: new Date("2026-09-01T00:00:00.123Z"), id: "fire_1" };
    const query = automationRestFiresQuerySchema.parse({ cursor: encodeTriggerFireCursor(cursor) });

    expect(query.cursor).toEqual(cursor);
    expect(query.limit).toBe(20);
  });

  it.each(["not-a-cursor", btoa(JSON.stringify({ id: "x" })), btoa("{")])(
    "refuses a cursor it did not issue (%s)",
    (cursor) => {
      expect(automationRestFiresQuerySchema.validate({ cursor })).toBe(false);
    },
  );

  it.each(["0", "101"])("refuses a limit of %s", (limit) => {
    expect(automationRestFiresQuerySchema.validate({ limit })).toBe(false);
  });
});
