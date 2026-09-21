import { describe, expect, it } from "vitest";

import {
  DnsSsoDomainProofChannel,
  type TxtRecordResolver,
} from "../dns.sso-domain-proof.channel.ts";
import { MemorySsoDomainProofChannel } from "../memory/memory.sso-domain-proof.channel.ts";

/**
 * Telling "nothing is published there" apart from "we could not find out"
 * (specs/identity/sso-domain-verification.feature). The resolver is injected,
 * so no test here touches real DNS.
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
  channel: DnsSsoDomainProofChannel;
  resolver: StubResolver;
} {
  const resolver = new StubResolver(answer);

  return { channel: DnsSsoDomainProofChannel.create({ resolver }), resolver };
}

describe("given a lookup of the verification name", () => {
  describe("when the name resolves to records", () => {
    /** @scenario "A name with nothing on it and a resolver that will not answer are told apart" */
    it("answers what is published, joining a value the protocol split up", async () => {
      const { channel, resolver } = lookupWith(async () => [
        ["v=spf1 include:example.com ~all"],
        ["first-half-", "second-half"],
      ]);

      const result = await channel.lookupTxtValues({ domain: "acme.com", name: NAME });

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
        const { channel } = lookupWith(answer as () => Promise<string[][]>);

        expect(await channel.lookupTxtValues({ domain: "acme.com", name: NAME })).toEqual({
          outcome: "absent",
        });
      }
    });
  });

  describe("when the lookup itself fails", () => {
    /** @scenario "A name with nothing on it and a resolver that will not answer are told apart" */
    it("says the lookup could not happen, and never that the record is absent", async () => {
      for (const code of ["ESERVFAIL", "ETIMEOUT", "EREFUSED", "ECONNREFUSED", "EBADRESP"]) {
        const { channel } = lookupWith(() => Promise.reject(dnsError(code)));

        expect(await channel.lookupTxtValues({ domain: "acme.com", name: NAME })).toEqual({
          outcome: "unreachable",
          reason: code,
        });
      }
    });

    /** @scenario "A name with nothing on it and a resolver that will not answer are told apart" */
    it("still says so when the failure carries no code at all", async () => {
      const { channel } = lookupWith(() => Promise.reject(new Error("the socket went away")));

      const result = await channel.lookupTxtValues({ domain: "acme.com", name: NAME });

      // The unknown case falls to "we could not find out" rather than to
      // "nothing is published": guessing wrong in that direction tells a
      // customer their DNS is broken when ours is.
      expect(result).toMatchObject({ outcome: "unreachable" });
    });
  });
});

describe("given the memory twin of the same channel", () => {
  /** @scenario "A name with nothing on it and a resolver that will not answer are told apart" */
  it("answers the three outcomes a test seeds, and absent for a name nothing seeded", async () => {
    const channel = MemorySsoDomainProofChannel.create();
    channel.seedPublished({ name: NAME, values: ["langwatch-domain-verification=token"] });
    channel.seedUnreachable({ name: "_langwatch-verification.down.example", reason: "ESERVFAIL" });

    expect(await channel.lookupTxtValues({ domain: "acme.com", name: NAME })).toEqual({
      outcome: "published",
      values: ["langwatch-domain-verification=token"],
    });
    expect(
      await channel.lookupTxtValues({
        domain: "down.example",
        name: "_langwatch-verification.down.example",
      }),
    ).toEqual({ outcome: "unreachable", reason: "ESERVFAIL" });
    expect(
      await channel.lookupTxtValues({ domain: "quiet.example", name: "_langwatch.quiet.example" }),
    ).toEqual({ outcome: "absent" });
    expect(channel.asked).toHaveLength(3);
  });
});
