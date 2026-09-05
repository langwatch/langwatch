import { describe, expect, it } from "vitest";
import {
  DnsDomainProofLookup,
  type TxtRecordResolver,
} from "../sso-self-serve-adapters";

/**
 * Telling "nothing is published there" apart from "we could not find out"
 * (specs/identity/sso-domain-verification.feature).
 *
 * The resolver is injected, so no test in this repository ever touches real
 * DNS — and what is actually under test is the classification, which is the
 * decision the customer-facing refusal is chosen from.
 */

const NAME = "_langwatch-verification.acme.com";

function dnsError(code: string): Error {
  return Object.assign(new Error(`queryTxt ${code} ${NAME}`), { code });
}

class StubResolver implements TxtRecordResolver {
  asked: string[] = [];

  constructor(private readonly answer: () => Promise<string[][]>) {}

  async resolveTxt(name: string): Promise<string[][]> {
    this.asked.push(name);
    return this.answer();
  }
}

function lookupWith(answer: () => Promise<string[][]>): {
  lookup: DnsDomainProofLookup;
  resolver: StubResolver;
} {
  const resolver = new StubResolver(answer);
  return { lookup: new DnsDomainProofLookup({ resolver }), resolver };
}

describe("given a lookup of the verification name", () => {
  describe("when the name resolves to records", () => {
    /** @scenario "A name with nothing on it and a resolver that will not answer are told apart" */
    it("answers what is published, joining a value the protocol split up", async () => {
      const { lookup, resolver } = lookupWith(async () => [
        ["v=spf1 include:example.com ~all"],
        ["first-half-", "second-half"],
      ]);

      const result = await lookup.lookupTxtValues({
        domain: "acme.com",
        name: NAME,
      });

      expect(result).toEqual({
        outcome: "published",
        values: ["v=spf1 include:example.com ~all", "first-half-second-half"],
      });
      expect(resolver.asked).toEqual([NAME]);
    });
  });

  describe("when the resolver says there is nothing there", () => {
    /** @scenario "A name with nothing on it and a resolver that will not answer are told apart" */
    it("reads no such name, no such record, and an empty answer as absent", async () => {
      for (const answer of [
        () => Promise.reject(dnsError("ENOTFOUND")),
        () => Promise.reject(dnsError("ENODATA")),
        () => Promise.resolve([]),
      ]) {
        const { lookup } = lookupWith(answer as () => Promise<string[][]>);
        expect(
          await lookup.lookupTxtValues({ domain: "acme.com", name: NAME }),
        ).toEqual({ outcome: "absent" });
      }
    });
  });

  describe("when the lookup itself fails", () => {
    /** @scenario "A name with nothing on it and a resolver that will not answer are told apart" */
    it("says the lookup could not happen, and never that the record is absent", async () => {
      for (const code of [
        "ESERVFAIL",
        "ETIMEOUT",
        "EREFUSED",
        "ECONNREFUSED",
        "EBADRESP",
      ]) {
        const { lookup } = lookupWith(() => Promise.reject(dnsError(code)));
        expect(
          await lookup.lookupTxtValues({ domain: "acme.com", name: NAME }),
        ).toEqual({ outcome: "unreachable", reason: code });
      }
    });

    /** @scenario "A name with nothing on it and a resolver that will not answer are told apart" */
    it("still says so when the failure carries no code at all", async () => {
      const { lookup } = lookupWith(() =>
        Promise.reject(new Error("the socket went away")),
      );

      const result = await lookup.lookupTxtValues({
        domain: "acme.com",
        name: NAME,
      });

      // The unknown case falls to "we could not find out" rather than to
      // "nothing is published": guessing wrong in that direction tells a
      // customer their DNS is broken when ours is.
      expect(result).toMatchObject({ outcome: "unreachable" });
    });
  });
});
