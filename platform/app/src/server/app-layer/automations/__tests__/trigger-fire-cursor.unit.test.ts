import { describe, expect, it } from "vitest";
import {
  decodeTriggerFireCursor,
  encodeTriggerFireCursor,
} from "../trigger-fire-cursor";

describe("trigger fire cursor", () => {
  it("decodes what it encodes", () => {
    const cursor = {
      createdAt: new Date("2026-09-28T10:00:00.123Z"),
      id: "ts_1",
    };
    expect(decodeTriggerFireCursor(encodeTriggerFireCursor(cursor))).toEqual(
      cursor,
    );
  });

  it("reads a cursor it did not issue as none", () => {
    expect(decodeTriggerFireCursor("not-a-cursor")).toBeNull();
    expect(
      decodeTriggerFireCursor(
        Buffer.from(JSON.stringify({ id: "x" })).toString("base64url"),
      ),
    ).toBeNull();
  });
});
