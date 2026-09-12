import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { passkeySignUpClaimMatches } from "../credential-account.prisma.repository";

const claimHash = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

describe("unfinished passkey sign-up claims", () => {
  /** @scenario Another browser cannot claim an unfinished passkey sign-up */
  it("refuses a distinct-token attacker racing to adopt another browser's row", () => {
    expect(
      passkeySignUpClaimMatches({
        storedClaimHash: claimHash("victim"),
        presentedClaimHash: claimHash("attacker"),
      }),
    ).toBe(false);
  });

  /** @scenario Only the same browser can continue an unfinished passkey sign-up */
  it("allows the same browser token to retry its unfinished sign-up", () => {
    expect(
      passkeySignUpClaimMatches({
        storedClaimHash: claimHash("same"),
        presentedClaimHash: claimHash("same"),
      }),
    ).toBe(true);
  });

  /** @scenario Legacy unfinished accounts without a claim are not publicly adoptable */
  it("does not let pre-capability residue become publicly adoptable", () => {
    expect(
      passkeySignUpClaimMatches({
        storedClaimHash: null,
        presentedClaimHash: claimHash("new"),
      }),
    ).toBe(false);
  });
});
