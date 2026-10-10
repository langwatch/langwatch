import { describe, expect, it } from "vitest";

import { UserAccountService } from "../user-account.service.ts";

function createService() {
  return UserAccountService.create();
}

describe("UserAccountService", () => {
  it("accepts a legacy project key as its own personal caller", () => {
    const service = createService();

    expect(
      service.personalCallerFor({
        project: { isPersonal: true, ownerUserId: "owner" },
        callerUserId: undefined,
      }),
    ).toBe("owner");
  });

  it("rejects a user-bound key for another personal workspace", () => {
    const service = createService();

    expect(() =>
      service.personalCallerFor({
        project: { isPersonal: true, ownerUserId: "owner" },
        callerUserId: "other",
      }),
    ).toThrow("cannot read another user's personal workspace");
  });
});
