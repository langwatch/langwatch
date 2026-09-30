import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmSignUpAddress,
  SIGN_UP_CONFIRM_ADDRESS_URL,
} from "../confirmSignUpAddress";

describe("confirmSignUpAddress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** @scenario An expired verification link offers a resend, nothing else */
  it("preserves the handled refusal and status for the recovery screen", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "identity_verification_expired" }), {
        status: 410,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      confirmSignUpAddress({ token: "expired-token" }),
    ).rejects.toMatchObject({
      error: "identity_verification_expired",
      status: 410,
    });
    expect(fetch).toHaveBeenCalledWith(SIGN_UP_CONFIRM_ADDRESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token: "expired-token" }),
    });
  });
});
