import { describe, expect, it } from "vitest";
import { cliSessionSchema, cliTokenRecordSchema } from "../cli-sessions";

describe("CLI sessions contract", () => {
  it("rejects malformed token records and session outputs", () => {
    expect(
      cliTokenRecordSchema.safeParse({
        user_id: "user",
        organization_id: "org",
        issued_at: "now",
        expires_at: 10,
      }).success,
    ).toBe(false);
    expect(
      cliSessionSchema.safeParse({
        sessionStartedAtMs: 1,
        deviceLabel: "device",
        hostname: null,
        uname: null,
        platform: null,
        lastSeenMs: 2,
        expiresAtMs: 3,
        tokenKeys: [],
        secret: "leak",
      }).success,
    ).toBe(false);
  });
});
