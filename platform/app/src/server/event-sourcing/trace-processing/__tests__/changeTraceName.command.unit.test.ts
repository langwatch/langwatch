import { describe, expect, it } from "vitest";
import { changeTraceName } from "../changeTraceName.command";
import { TRACE_ID } from "./fixtures";

describe("the changeTraceName command", () => {
  it("emits exactly the traceNameChanged event", async () => {
    const input = {
      traceId: TRACE_ID,
      newName: "Renamed",
      changedByUserId: "u-1",
      changedAt: 700,
    };
    expect(await changeTraceName(input)).toEqual([
      { type: "traceNameChanged", data: input },
    ]);
  });
});
