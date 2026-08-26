import { describe, expect, it } from "vitest";
import { HttpsDomainProofFileLookup } from "../sso-domain-file-lookup";

/**
 * Telling "nothing is served there" apart from "we could not read it"
 * (specs/identity/sso-domain-verification.feature, the file channel).
 *
 * The fetch is injected, so no test here touches the network — and what is
 * under test is the classification, which is the decision the
 * customer-facing refusal is chosen from: only a clean not-found may tell an
 * administrator their file is missing.
 */

const URL_UNDER_TEST =
  "https://acme.com/.well-known/langwatch-verification.txt";

function lookupAnswering(response: () => Promise<Response>): {
  lookup: HttpsDomainProofFileLookup;
  asked: string[];
} {
  const asked: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return response();
  }) as typeof fetch;
  // Resolves to a public address unless a test says otherwise, so no case
  // here touches DNS.
  return {
    lookup: new HttpsDomainProofFileLookup(fetchImpl, async () => [
      "93.184.216.34",
    ]),
    asked,
  };
}

const fetchFile = (lookup: HttpsDomainProofFileLookup) =>
  lookup.fetchVerificationFile({ domain: "acme.com", url: URL_UNDER_TEST });

describe("given a fetch of the verification file", () => {
  describe("when the domain serves the file", () => {
    /** @scenario "Serving the file proves the domain through the same ceremony" */
    it("answers the non-empty lines, trimmed", async () => {
      const { lookup, asked } = lookupAnswering(async () =>
        respond(200, "  lw-token-123  \n\n"),
      );

      const result = await fetchFile(lookup);

      expect(asked).toEqual([URL_UNDER_TEST]);
      expect(result).toEqual({ outcome: "served", values: ["lw-token-123"] });
    });

    it("answers absent for a file with nothing in it", async () => {
      const { lookup } = lookupAnswering(async () => respond(200, "\n \n"));

      expect(await fetchFile(lookup)).toEqual({ outcome: "absent" });
    });
  });

  describe("when the domain says the file is not there", () => {
    /** @scenario "A file that is not served yet is not a failed proof" */
    it("answers absent for a clean not-found", async () => {
      const { lookup } = lookupAnswering(async () => respond(404, "not here"));

      expect(await fetchFile(lookup)).toEqual({ outcome: "absent" });
    });
  });

  describe("when the fetch cannot be answered", () => {
    /** @scenario "A fetch that could not happen says so, and blames nobody" */
    it("classifies a server error as unreachable, never as absent", async () => {
      const { lookup } = lookupAnswering(async () => respond(503, "down"));

      expect(await fetchFile(lookup)).toEqual({
        outcome: "unreachable",
        reason: "http_503",
      });
    });

    it("classifies a refused connection as unreachable", async () => {
      const { lookup } = lookupAnswering(async () => {
        throw Object.assign(new Error("fetch failed"), {
          code: "ECONNREFUSED",
        });
      });

      expect(await fetchFile(lookup)).toEqual({
        outcome: "unreachable",
        reason: "ECONNREFUSED",
      });
    });

    /** @scenario "A token read off https proves nothing" */
    it("refuses a journey that ended off https", async () => {
      const { lookup } = lookupAnswering(async () =>
        respond(200, "lw-token-123", "http://acme.com/verification.txt"),
      );

      expect(await fetchFile(lookup)).toEqual({
        outcome: "unreachable",
        reason: "insecure_redirect",
      });
    });

    it("refuses a body too large to be the token", async () => {
      const { lookup } = lookupAnswering(async () =>
        respond(200, "x".repeat(70 * 1024)),
      );

      expect(await fetchFile(lookup)).toEqual({
        outcome: "unreachable",
        reason: "file_too_large",
      });
    });
  });
});

/** A Response whose final `url` can be pinned, the way a redirect pins it. */
describe("given a fetch aimed somewhere on our own network", () => {
  describe("when the URL names a private address outright", () => {
    it("never connects, and says the host is not public", async () => {
      const { lookup, asked } = lookupAnswering(async () =>
        respond(200, "lw-token-123"),
      );

      const result = await lookup.fetchVerificationFile({
        domain: "169.254.169.254",
        url: "https://169.254.169.254/.well-known/langwatch-verification.txt",
      });

      expect(result).toEqual({
        outcome: "unreachable",
        reason: "host_not_public",
      });
      // The point is the CONNECTION that did not happen. The body is only
      // ever hash-compared, so a blind fetch still answers a reachability and
      // port oracle for whatever it reached.
      expect(asked).toEqual([]);
    });
  });

  describe("when the domain redirects into private space", () => {
    it("stops at the hop rather than following it", async () => {
      // A redirect is not the claimed domain: it is a string the customer's
      // own web server chose, at request time, after the claim was approved.
      // `redirect: "follow"` would hand the whole journey to the runtime.
      const { lookup, asked } = lookupAnswering(async () => {
        const response = new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/.well-known/x.txt" },
        });
        Object.defineProperty(response, "url", { value: URL_UNDER_TEST });
        return response;
      });

      const result = await lookup.fetchVerificationFile({
        domain: "acme.com",
        url: URL_UNDER_TEST,
      });

      expect(result).toEqual({
        outcome: "unreachable",
        reason: "host_not_public",
      });
      // The first hop was made — that one is the customer's own domain — and
      // the second was not.
      expect(asked).toEqual([URL_UNDER_TEST]);
    });
  });

  describe("when the domain resolves into private space", () => {
    it("refuses the name even though the name itself looks ordinary", async () => {
      // The shape check at claim time cannot catch this: `intranet.acme.com`
      // is a perfectly well-formed public hostname, and whether it answers
      // with 10.0.0.5 is a fact about DNS at request time.
      const asked: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return respond(200, "lw-token-123");
      }) as typeof fetch;
      const lookup = new HttpsDomainProofFileLookup(fetchImpl, async () => [
        "10.0.0.5",
      ]);

      const result = await lookup.fetchVerificationFile({
        domain: "intranet.acme.com",
        url: "https://intranet.acme.com/.well-known/langwatch-verification.txt",
      });

      expect(result).toEqual({
        outcome: "unreachable",
        reason: "host_not_public",
      });
      expect(asked).toEqual([]);
    });

    it("refuses a name that answers with one public and one private address", async () => {
      const fetchImpl = (async () => respond(200, "x")) as typeof fetch;
      const lookup = new HttpsDomainProofFileLookup(fetchImpl, async () => [
        "93.184.216.34",
        "127.0.0.1",
      ]);

      // Which address a later connect picks is not ours to decide, so one
      // private answer is enough.
      const result = await lookup.fetchVerificationFile({
        domain: "acme.com",
        url: URL_UNDER_TEST,
      });
      expect(result).toEqual({
        outcome: "unreachable",
        reason: "host_not_public",
      });
    });
  });

  describe("when the domain redirects round and round", () => {
    it("gives up rather than following forever", async () => {
      const { lookup, asked } = lookupAnswering(async () => {
        const response = new Response(null, {
          status: 302,
          headers: { location: URL_UNDER_TEST },
        });
        Object.defineProperty(response, "url", { value: URL_UNDER_TEST });
        return response;
      });

      const result = await lookup.fetchVerificationFile({
        domain: "acme.com",
        url: URL_UNDER_TEST,
      });

      expect(result.outcome).toBe("unreachable");
      expect(asked.length).toBeLessThanOrEqual(6);
    });
  });
});

function respond(status: number, body: string, url = URL_UNDER_TEST): Response {
  const response = new Response(status === 204 ? null : body, { status });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
