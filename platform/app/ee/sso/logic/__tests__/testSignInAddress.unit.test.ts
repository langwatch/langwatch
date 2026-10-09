import { describe, expect, it } from "vitest";
import { testSignInAddressNote } from "../testSignInAddress";

/**
 * What the setup screen says before somebody spends a round trip to their
 * identity provider learning it (specs/identity/sso-assertion-refusals.feature).
 *
 * The rule this warns about is real and deliberate — a connection that is not
 * live accepts only the registrant's address — and it is the single least
 * guessable thing about the journey. Everything below is about saying it at
 * the moment it can still save the attempt.
 */

const LIVE_DOMAINS = ["acme.com"];

describe("given a connection that is still being set up", () => {
  describe("when the reader's address is on the connection's own domain", () => {
    it("tells them only one address works, without alarming them", () => {
      const note = testSignInAddressNote({
        connectionState: "VERIFIED",
        verifiedDomains: LIVE_DOMAINS,
        yourAddress: "ana@acme.com",
      });

      expect(note).toMatchObject({
        tone: "info",
        yourAddress: "ana@acme.com",
        addressIsOffDomain: false,
      });
    });
  });

  describe("when the reader's address is on none of the connection's domains", () => {
    it("warns, because the sign-in is going to be refused", () => {
      // The case this was written for: an administrator whose own account is
      // at one address testing a connection built for a different company's
      // domain. The provider asserts an address on that domain, the gate
      // accepts only the registrant's, and the refusal arrives after the
      // round trip rather than before it.
      const note = testSignInAddressNote({
        connectionState: "VERIFIED",
        verifiedDomains: ["acme1.test"],
        yourAddress: "admin@haven.localhost",
      });

      expect(note).toMatchObject({
        tone: "warning",
        yourAddress: "admin@haven.localhost",
        connectionDomains: ["acme1.test"],
        addressIsOffDomain: true,
      });
    });

    it("compares the domains case-insensitively", () => {
      expect(
        testSignInAddressNote({
          connectionState: "DRAFT",
          verifiedDomains: ["ACME.com"],
          yourAddress: "Ana@Acme.COM",
        }),
      ).toMatchObject({ tone: "info", addressIsOffDomain: false });
    });
  });

  describe("when the connection has proved no domain at all", () => {
    it("does not claim the address is off-domain", () => {
      // A connection set up for nowhere yet has no domain for an address to
      // be off. Warning here would be alarming somebody about nothing.
      expect(
        testSignInAddressNote({
          connectionState: "DRAFT",
          verifiedDomains: [],
          yourAddress: "ana@acme.com",
        }),
      ).toMatchObject({ tone: "info", addressIsOffDomain: false });
    });
  });

  describe("when the reader's address is not known", () => {
    it.each([
      ["absent", undefined],
      ["null", null],
      ["blank", "   "],
    ])("says nothing when it is %s", (_case, yourAddress) => {
      // Every sentence worth writing here names the address.
      expect(
        testSignInAddressNote({
          connectionState: "DRAFT",
          verifiedDomains: LIVE_DOMAINS,
          yourAddress,
        }),
      ).toBeNull();
    });
  });
});

describe("given a connection that has gone live", () => {
  describe("when anybody looks at the test", () => {
    it("says nothing, because the one-address rule has stopped applying", () => {
      // A live connection accepts every address on the domains it proved, so
      // the warning would be false rather than merely redundant.
      expect(
        testSignInAddressNote({
          connectionState: "ACTIVE",
          verifiedDomains: ["acme1.test"],
          yourAddress: "admin@haven.localhost",
        }),
      ).toBeNull();
    });
  });
});
