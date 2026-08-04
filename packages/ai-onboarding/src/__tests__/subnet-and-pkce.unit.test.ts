import { describe, expect, it } from "vitest";
import { subnetKey } from "../domain/net.js";
import {
  deriveCodeChallenge,
  mintSecret,
  mintUserCode,
  peppered,
  verifyCodeChallenge,
} from "../domain/tokens.js";

describe("subnet grouping", () => {
  describe("when a caller rotates addresses inside one v4 /24", () => {
    /** @scenario "the IP subnet axis groups v4 by /24 and v6 by /64" */
    it("groups v4 by /24 and v6 by /64 into one bucket each", () => {
      const keys = ["192.0.2.1", "192.0.2.99", "192.0.2.254"].map(subnetKey);

      expect(new Set(keys).size).toBe(1);
    });

    it("keeps a different /24 apart", () => {
      expect(subnetKey("192.0.2.1")).not.toBe(subnetKey("192.0.3.1"));
    });
  });

  describe("when a caller is handed fresh v6 addresses inside one /64", () => {
    it("puts every v6 address of one /64 in the same bucket", () => {
      const keys = [
        "2001:db8:abcd:1234:0000:0000:0000:0001",
        "2001:db8:abcd:1234::beef",
        "2001:db8:abcd:1234:ffff:ffff:ffff:ffff",
      ].map(subnetKey);

      expect(new Set(keys).size).toBe(1);
    });

    it("keeps a different /64 apart", () => {
      expect(subnetKey("2001:db8:abcd:1234::1")).not.toBe(
        subnetKey("2001:db8:abcd:9999::1"),
      );
    });
  });

  describe("when the address is v4 wearing a v6 prefix", () => {
    it("meters it as the v4 subnet it really is", () => {
      expect(subnetKey("::ffff:192.0.2.7")).toBe(subnetKey("192.0.2.7"));
    });
  });

  describe("when the address does not parse", () => {
    it("meters it as its own bucket rather than a shared one", () => {
      expect(subnetKey("not-an-address")).not.toBe(subnetKey("also-not-one"));
    });
  });
});

describe("PKCE", () => {
  describe("given a verifier and the challenge derived from it", () => {
    it("verifies", () => {
      const verifier = mintSecret();
      expect(
        verifyCodeChallenge({
          codeVerifier: verifier,
          codeChallenge: deriveCodeChallenge(verifier),
        }),
      ).toBe(true);
    });
  });

  describe("given a verifier someone made up", () => {
    it("does not verify", () => {
      expect(
        verifyCodeChallenge({
          codeVerifier: mintSecret(),
          codeChallenge: deriveCodeChallenge(mintSecret()),
        }),
      ).toBe(false);
    });
  });

  describe("when the challenge is a different length entirely", () => {
    it("refuses instead of throwing on the comparison", () => {
      expect(
        verifyCodeChallenge({
          codeVerifier: mintSecret(),
          codeChallenge: "short",
        }),
      ).toBe(false);
    });
  });
});

describe("secrets", () => {
  describe("when minting", () => {
    it("does not repeat", () => {
      const minted = new Set(Array.from({ length: 200 }, () => mintSecret()));
      expect(minted.size).toBe(200);
    });

    it("produces url-safe tokens that need no encoding in a link", () => {
      expect(mintSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("when minting a user-facing confirmation code", () => {
    it("leaves out glyphs a human would misread", () => {
      const codes = Array.from({ length: 100 }, () => mintUserCode()).join("");
      expect(codes).not.toMatch(/[01OI]/);
    });
  });

  describe("when hashing with a pepper", () => {
    it("gives a different digest under a different pepper", () => {
      expect(peppered("1.2.3.4", "pepper-a")).not.toBe(
        peppered("1.2.3.4", "pepper-b"),
      );
    });

    it("is stable for the same value and pepper", () => {
      expect(peppered("1.2.3.4", "p")).toBe(peppered("1.2.3.4", "p"));
    });
  });
});
