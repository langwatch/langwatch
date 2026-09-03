import { describe, expect, it } from "vitest";
import { adminIdentitySchema, startImpersonationInputSchema } from "../index";

describe("admin contract", () => {
  it("accepts a nullable admin identity email", () => {
    expect(adminIdentitySchema.parse({ email: null })).toEqual({ email: null });
  });

  it("requires a non-empty impersonation reason", () => {
    expect(
      startImpersonationInputSchema.safeParse({
        sessionId: "session_1",
        impersonatorUserId: "user_admin",
        userIdToImpersonate: "user_target",
        reason: "",
        req: { headers: {} },
      }).success,
    ).toBe(false);
  });
});
