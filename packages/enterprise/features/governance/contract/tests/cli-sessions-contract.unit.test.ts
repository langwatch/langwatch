import { describe, expect, it } from "vitest";
import {
  cliAccessTokenKey,
  cliRefreshTokenKey,
  cliSessionSchema,
  cliTokenRecordSchema,
  cliUserTokensIndexKey,
} from "../src/cli-sessions";

describe("CLI sessions contract", () => {
  it("keeps the existing Redis key protocol stable", () => {
    expect(cliUserTokensIndexKey("user")).toBe("lwcli:user:user:tokens");
    expect(cliAccessTokenKey("access")).toBe("lwcli:access:access");
    expect(cliRefreshTokenKey("refresh")).toBe("lwcli:refresh:refresh");
  });

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
