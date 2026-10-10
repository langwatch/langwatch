/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { passkeySignUpContext } from "../passkey-sign-up-claim.ts";

const read = (context: string): unknown => JSON.parse(context);
const CLAIM = z.object({ claim: z.string() });

describe("passkeySignUpContext", () => {
  beforeEach(() => sessionStorage.clear());

  it("carries the normalised address, a claim and the proof", () => {
    expect(read(passkeySignUpContext({ email: " Sam@Acme.com ", addressProof: "p1" }))).toEqual({
      email: "sam@acme.com",
      claim: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      addressProof: "p1",
    });
  });

  it("reuses the tab's claim for the same address on a retry", () => {
    const first = read(passkeySignUpContext({ email: "sam@acme.com" }));
    const again = read(passkeySignUpContext({ email: "SAM@acme.com" }));

    expect(again).toEqual(first);
  });

  it("gives another address its own claim", () => {
    const sam = CLAIM.parse(read(passkeySignUpContext({ email: "sam@acme.com" })));
    const ana = CLAIM.parse(read(passkeySignUpContext({ email: "ana@acme.com" })));

    expect(ana.claim).not.toBe(sam.claim);
  });
});
