import { describe, expect, it } from "vitest";
import { recordSpan } from "../recordSpan.command";
import { canonicalSpan } from "./fixtures";

describe("the recordSpan command", () => {
  it("emits exactly the spanReceived event, carrying the already-canonicalized span through unchanged", async () => {
    const span = canonicalSpan();
    expect(await recordSpan(span)).toEqual([
      { type: "spanReceived", data: span },
    ]);
  });
});
