import type { IdentityApi } from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { createUserTestApp } from "./user.fixture.ts";

describe("UserApp.completeEmailVerification", () => {
  it("forwards the user-bound PKCE proof to the installed identity application", async () => {
    const completeEmailVerification = vi.fn(async () => undefined);
    const identity = createApiFixture<IdentityApi>({ completeEmailVerification });
    const app = createUserTestApp({ dependencies: { identity } });
    const input = {
      userId: "user_1",
      identifierId: "identifier_1",
      verificationId: "verification_1",
      token: "mailbox-token",
      codeVerifier: "a".repeat(43),
    };

    await expect(app.completeEmailVerification(input)).resolves.toEqual({ verified: true });
    expect(completeEmailVerification).toHaveBeenCalledWith(input);
  });
});
