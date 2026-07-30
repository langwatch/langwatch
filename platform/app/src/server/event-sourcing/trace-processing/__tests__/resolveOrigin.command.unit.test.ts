import { describe, expect, it } from "vitest";
import { resolveOrigin } from "../resolveOrigin.command";
import { TRACE_ID } from "./fixtures";

describe("the resolveOrigin command", () => {
  it("emits exactly the originResolved event", async () => {
    const input = { traceId: TRACE_ID, origin: "evaluation", reason: "fallback" };
    expect(await resolveOrigin(input)).toEqual([{ type: "originResolved", data: input }]);
  });
});
