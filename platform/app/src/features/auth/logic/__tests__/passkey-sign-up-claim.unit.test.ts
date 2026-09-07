// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { passkeySignUpContext } from "../passkey-sign-up-claim";

describe("passkeySignUpContext", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  /** @scenario Only the same browser can continue an unfinished passkey sign-up */
  it("reuses one 32-byte claim for retries of the same normalized address", () => {
    const getRandomValues = vi.spyOn(crypto, "getRandomValues");

    const first = JSON.parse(passkeySignUpContext(" Sam@Example.com "));
    const retry = JSON.parse(passkeySignUpContext("sam@example.com"));

    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      email: "sam@example.com",
      claim: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it("mints distinct claims for distinct addresses in the same tab", () => {
    const first = JSON.parse(passkeySignUpContext("sam@example.com"));
    const second = JSON.parse(passkeySignUpContext("alex@example.com"));

    expect(second.claim).not.toBe(first.claim);
  });
});
