import { describe, expect, it } from "vitest";
import { recordAuditLogCommandSchema } from "../src";

describe("recordAuditLogCommandSchema", () => {
  it("round-trips portable audit data", () => {
    const input = {
      userId: "user_1",
      organizationId: "org_1",
      action: "project.update",
      args: { name: "Renamed" },
      metadata: { source: "api" },
    };
    expect(recordAuditLogCommandSchema.parse(input)).toEqual(input);
  });

  it("rejects non-portable metadata", () => {
    expect(
      recordAuditLogCommandSchema.safeParse({
        userId: "user_1",
        action: "project.update",
        metadata: { callback: () => undefined },
      }).success,
    ).toBe(false);
  });
});
