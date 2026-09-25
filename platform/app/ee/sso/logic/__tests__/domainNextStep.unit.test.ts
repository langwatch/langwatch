import { describe, expect, it } from "vitest";
import { domainNextStepFor } from "../domainNextStep";

/**
 * What a domain row offers, and — the case this table exists for — what it
 * must stop offering once a value is out.
 */

const unproved = {
  proved: false,
  proofState: "VERIFIED" as const,
  claim: undefined,
  provesWithLicense: false,
};

describe("domainNextStepFor", () => {
  describe("given a domain nobody has claimed evidence for yet", () => {
    it("offers to prove it", () => {
      expect(domainNextStepFor(unproved).kind).toBe("get-record");
    });

    it("always says what happens next, so no row is silently a dead end", () => {
      expect(domainNextStepFor(unproved).explanation).not.toBe("");
    });
  });

  describe("given a claim waiting on the customer rather than on us", () => {
    // The hosted tier decides a claim BY publishing the record, so the row
    // must offer the record while the claim is still WAITING — gating it on
    // APPROVED left the ordinary path with a status and no way forward.
    it("offers to prove it rather than telling them to wait", () => {
      const next = domainNextStepFor({
        ...unproved,
        claim: { state: "WAITING", waitsForReview: false },
      });
      expect(next.kind).toBe("get-record");
      expect(next.action).not.toBeNull();
    });
  });

  describe("given a claim a person here has to decide", () => {
    it("offers nothing to press, because the move is not theirs", () => {
      const next = domainNextStepFor({
        ...unproved,
        claim: { state: "WAITING", waitsForReview: true },
      });
      expect(next.kind).toBe("waiting-on-us");
      expect(next.action).toBeNull();
    });
  });

  describe("given a value already handed over for this domain", () => {
    const issued = domainNextStepFor({ ...unproved, recordIssued: true });

    // Proving again MINTS A NEW TOKEN and retires the old one. A row that
    // kept offering it would invite somebody who had already published the
    // value into invalidating it, with nothing on screen saying so.
    it("stops offering to prove it", () => {
      expect(issued.kind).toBe("publish-it");
      expect(issued.action).toBeNull();
    });

    it("warns that asking again would replace what they published", () => {
      expect(issued.explanation).toMatch(/replaces it with a new value/i);
    });
  });

  describe("given a licensed installation, where proving publishes nothing", () => {
    it("keeps offering the one press, since there is no value to invalidate", () => {
      const next = domainNextStepFor({
        ...unproved,
        provesWithLicense: true,
        recordIssued: true,
      });
      expect(next.kind).toBe("get-record");
      expect(next.action).toBe("Prove with our licence");
    });
  });

  describe("given a proved domain whose evidence has gone", () => {
    it("offers a fresh record rather than reporting it as proved", () => {
      const next = domainNextStepFor({
        ...unproved,
        proved: true,
        proofState: "LAPSED",
      });
      expect(next.kind).toBe("republish");
    });
  });

  describe("given a proved domain whose evidence is still there", () => {
    it("offers nothing to press", () => {
      const next = domainNextStepFor({ ...unproved, proved: true });
      expect(next.kind).toBe("done");
      expect(next.action).toBeNull();
    });
  });
});
