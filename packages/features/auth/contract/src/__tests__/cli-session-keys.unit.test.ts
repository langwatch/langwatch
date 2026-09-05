import { describe, expect, it } from "vitest";
import { cliAccessTokenKey, cliRefreshTokenKey, cliUserTokensIndexKey } from "../cli-session-keys";

describe("CLI session keys", () => {
  it("keeps the existing Redis key protocol stable", () => {
    expect(cliUserTokensIndexKey("user")).toBe("lwcli:user:user:tokens");
    expect(cliAccessTokenKey("access")).toBe("lwcli:access:access");
    expect(cliRefreshTokenKey("refresh")).toBe("lwcli:refresh:refresh");
  });
});
