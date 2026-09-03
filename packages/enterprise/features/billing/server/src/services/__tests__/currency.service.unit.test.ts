/**
 * Which currency a customer is quoted and billed in.
 *
 * The answer is a guess made from a request, and the cost of guessing wrong is
 * a price the customer did not expect, so the order it guesses in matters: a
 * country the CDN states outright beats one inferred from an IP address, and
 * anything unknown falls back to euros rather than picking a currency at
 * random.
 *
 * The local-address check is the part with no obvious caller and the worst
 * failure if it goes: on a self-hosted install every request arrives from
 * inside the network, and a geoip lookup of `10.0.0.4` answers with whatever
 * that block happens to map to.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Currency } from "@langwatch/enterprise-billing-contract";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("geoip-country", () => ({ default: { lookup } }));

const { CurrencyService, EUR_COUNTRIES } = await import("../currency.service");

const service = CurrencyService.create();

const detect = (headers: Record<string, string | string[] | undefined>) =>
  service.detect({ headers });

beforeEach(() => {
  lookup.mockReset();
  lookup.mockReturnValue(null);
});

describe("CurrencyService.fromCountry", () => {
  describe("given a country in the euro set", () => {
    it("bills in euros", () => {
      expect(CurrencyService.fromCountry("DE")).toBe(Currency.EUR);
      expect(CurrencyService.fromCountry("NL")).toBe(Currency.EUR);
    });

    it("does not care about the case it arrived in", () => {
      expect(CurrencyService.fromCountry("de")).toBe(Currency.EUR);
    });
  });

  describe("given a country outside it", () => {
    it("bills in dollars", () => {
      expect(CurrencyService.fromCountry("US")).toBe(Currency.USD);
      expect(CurrencyService.fromCountry("GB")).toBe(Currency.USD);
      expect(CurrencyService.fromCountry("JP")).toBe(Currency.USD);
    });
  });

  describe("given no country at all", () => {
    it("falls back to euros rather than guessing", () => {
      expect(CurrencyService.fromCountry(null)).toBe(Currency.EUR);
      expect(CurrencyService.fromCountry(undefined)).toBe(Currency.EUR);
      expect(CurrencyService.fromCountry("")).toBe(Currency.EUR);
    });
  });

  describe("the euro set itself", () => {
    it("holds the non-EU users of the euro, not just the EU", () => {
      // Monaco, Andorra, San Marino, the Vatican, Montenegro and Kosovo use
      // the euro without being in the EU, and a customer there quoted in
      // dollars would be quoted a currency they do not hold.
      for (const country of ["MC", "AD", "SM", "VA", "ME", "XK"]) {
        expect(EUR_COUNTRIES.has(country)).toBe(true);
      }
    });

    it("does not hold EU members that kept their own currency", () => {
      for (const country of ["PL", "CZ", "SE", "DK", "HU", "RO"]) {
        expect(EUR_COUNTRIES.has(country)).toBe(false);
      }
    });
  });
});

describe("CurrencyService.detect", () => {
  describe("given the CDN stated the country", () => {
    it("takes it from Vercel's header", () => {
      expect(detect({ "x-vercel-ip-country": "FR" })).toEqual({
        currency: Currency.EUR,
        country: "FR",
      });
    });

    it("takes it from Cloudflare's", () => {
      expect(detect({ "cf-ipcountry": "US" })).toEqual({
        currency: Currency.USD,
        country: "US",
      });
    });

    it("prefers Vercel's when both are present", () => {
      expect(detect({ "x-vercel-ip-country": "DE", "cf-ipcountry": "US" }).country).toBe("DE");
    });

    it("prefers a stated country over the address it could infer one from", () => {
      // A stated country is the CDN's own answer about where the request
      // entered; an address is a lookup that can be wrong.
      expect(detect({ "x-vercel-ip-country": "US", "cf-connecting-ip": "1.1.1.1" })).toEqual({
        currency: Currency.USD,
        country: "US",
      });
    });
  });

  describe("given no country and no address", () => {
    it("falls back to euros and reports no country", () => {
      expect(detect({})).toEqual({ currency: Currency.EUR, country: null });
      expect(service.detect(undefined)).toEqual({ currency: Currency.EUR, country: null });
    });
  });

  describe("given the request came from inside the network", () => {
    it("does not look the address up at all", () => {
      // On a self-hosted install every request looks like this. The lookup is
      // what has to be skipped, not merely its answer: the result is the same
      // either way, so only the absent call proves the rule holds.
      for (const ip of [
        "127.0.0.1",
        "::1",
        "::ffff:127.0.0.1",
        "192.168.1.7",
        "10.0.0.4",
        "172.16.0.1",
        "172.31.255.254",
      ]) {
        expect(detect({ "cf-connecting-ip": ip })).toEqual({
          currency: Currency.EUR,
          country: null,
        });
      }

      expect(lookup).not.toHaveBeenCalled();
    });

    it("still looks up 172.15 and 172.32, because the private block is 16 to 31", () => {
      // Reading the range too widely would silently refuse to locate real
      // customers on those addresses.
      detect({ "cf-connecting-ip": "172.15.0.1" });
      detect({ "cf-connecting-ip": "172.32.0.1" });

      expect(lookup.mock.calls.map((call) => call[0])).toEqual(["172.15.0.1", "172.32.0.1"]);
    });
  });

  describe("given a public address and no stated country", () => {
    it("bills by the country the lookup names", () => {
      lookup.mockReturnValue({ country: "FR" });

      expect(detect({ "cf-connecting-ip": "8.8.8.8" })).toEqual({
        currency: Currency.EUR,
        country: "FR",
      });
    });

    it("falls back to euros when the lookup names nobody", () => {
      lookup.mockReturnValue(null);

      expect(detect({ "cf-connecting-ip": "8.8.8.8" })).toEqual({
        currency: Currency.EUR,
        country: null,
      });
    });

    it("falls back rather than failing the request when the lookup throws", () => {
      // Currency detection sits on a page render. A geoip database that is
      // missing or corrupt must cost the customer a default, not an error.
      lookup.mockImplementation(() => {
        throw new Error("geoip database unavailable");
      });

      expect(detect({ "cf-connecting-ip": "8.8.8.8" })).toEqual({
        currency: Currency.EUR,
        country: null,
      });
    });
  });

  describe("the address it reads", () => {
    it("prefers Cloudflare's over the others", () => {
      detect({
        "cf-connecting-ip": "9.9.9.9",
        "x-real-ip": "8.8.8.8",
        "x-forwarded-for": "1.1.1.1",
      });

      expect(lookup).toHaveBeenCalledWith("9.9.9.9");
    });

    it("falls to x-real-ip when Cloudflare's is absent", () => {
      detect({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" });

      expect(lookup).toHaveBeenCalledWith("8.8.8.8");
    });

    it("takes the first hop of a forwarded chain, which is the client", () => {
      // The rest of the chain is the proxies it passed through, and locating
      // a proxy would bill everyone behind it in the proxy's currency.
      detect({ "x-forwarded-for": "1.1.1.1, 8.8.8.8" });

      expect(lookup).toHaveBeenCalledWith("1.1.1.1");
    });

    it("reads a header that arrived as a list", () => {
      detect({ "cf-connecting-ip": ["1.1.1.1", "8.8.8.8"] });

      expect(lookup).toHaveBeenCalledWith("1.1.1.1");
    });
  });
});
