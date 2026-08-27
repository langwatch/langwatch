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
    it("refuses a journey the domain redirects onto plain http", async () => {
      // Driven as the domain actually drives it: a real 302 whose Location
      // is http. The refusal has to come from the GUARD judging that hop,
      // before a socket is opened for it — not from inspecting where a
      // followed response says it landed, which is a thing the runtime
      // decides after the request we were trying to prevent already happened.
      const { lookup, asked } = lookupAnswering(async () =>
        redirectTo("http://acme.com/verification.txt"),
      );

      expect(await fetchFile(lookup)).toEqual({
        outcome: "unreachable",
        reason: "not_https",
      });
      // The https hop was fetched; the http one never was.
      expect(asked).toEqual([URL_UNDER_TEST]);
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

describe("given a name whose answer changes between the check and the socket", () => {
  describe("when the resolver answers publicly and would answer privately next", () => {
    it("dials the addresses it judged, not the name it judged them for", async () => {
      // DNS REBINDING, which is the ordinary way a check-then-dial guard is
      // defeated: a record with a one-second time-to-live answers publicly
      // for the check and `127.0.0.1` for the connection a moment later.
      // What makes this safe is not the check passing — it is that the
      // addresses the check validated are the addresses the connection is
      // pinned to, so a second answer never reaches a socket.
      const answers = [["93.184.216.34"], ["127.0.0.1"]];
      let call = 0;
      const seen: (RequestInit & { dispatcher?: unknown })[] = [];
      const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init ?? {});
        return respond(200, "lw-token-123");
      }) as typeof fetch;

      const lookup = new HttpsDomainProofFileLookup(fetchImpl, async () => {
        const answer = answers[Math.min(call, answers.length - 1)];
        call += 1;
        return answer ?? [];
      });

      await lookup.fetchVerificationFile({
        domain: "acme.com",
        url: URL_UNDER_TEST,
      });

      // The request carries a dispatcher rather than trusting the name.
      // Without one, the runtime resolves a second time and the rebind wins.
      expect(seen).toHaveLength(1);
      expect(seen[0]?.dispatcher).toBeDefined();
    });
  });

  describe("when the resolver cannot answer at all", () => {
    it("refuses rather than letting the fetch decide", async () => {
      // FAILING CLOSED. Treating a throw as "not a private host" meant the
      // guard could be skipped by making it fail, which is the cheapest
      // thing an attacker can do to a check — and a transient EAI_AGAIN
      // under resolver load did it by accident.
      const asked: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return respond(200, "lw-token-123");
      }) as typeof fetch;

      const lookup = new HttpsDomainProofFileLookup(fetchImpl, async () => {
        throw Object.assign(new Error("resolver is busy"), {
          code: "EAI_AGAIN",
        });
      });

      expect(
        await lookup.fetchVerificationFile({
          domain: "acme.com",
          url: URL_UNDER_TEST,
        }),
      ).toEqual({ outcome: "unreachable", reason: "unresolvable" });
      expect(asked).toEqual([]);
    });
  });
});

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

  // Every case above spells the private address the dotted way, and that is
  // exactly why the guard shipped with a hole: an address wearing an IPv6
  // coat took the other branch and was judged public. The WHATWG URL parser
  // re-serialises `::ffff:127.0.0.1` as `::ffff:7f00:1`, so the guard's
  // prefix strip left `7f00:1` — still a colon, no private prefix, allowed.
  describe("when the private address is written as IPv4-mapped IPv6", () => {
    const mapped: Array<[string, string]> = [
      ["::ffff:127.0.0.1", "loopback, spelled the dotted way"],
      ["::ffff:7f00:1", "the same loopback, as the URL parser rewrites it"],
      ["::ffff:a9fe:a9fe", "the cloud metadata endpoint"],
      ["::ffff:10.0.0.5", "private space"],
      ["::ffff:c0a8:1", "private space, in hex"],
    ];

    // NOT covered, and deliberately not forked here: the deprecated
    // v4-COMPATIBLE form (`::7f00:1`, RFC 4291 §2.5.5.1) classifies as global
    // in `@langwatch/ssrf`. That table is shared byte-for-byte with the Go AI
    // gateway, the Go Langy egress proxy and the NLP service, so one consumer
    // quietly disagreeing with it is worse than the gap. Raise it there.

    for (const [address, why] of mapped) {
      it(`refuses ${address} — ${why}`, async () => {
        const { lookup, asked } = lookupAnswering(async () =>
          respond(200, "lw-token-123"),
        );

        const result = await lookup.fetchVerificationFile({
          domain: "acme.com",
          url: `https://[${address}]/.well-known/langwatch-verification.txt`,
        });

        expect(result).toEqual({
          outcome: "unreachable",
          reason: "host_not_public",
        });
        expect(asked).toEqual([]);
      });
    }

    it("refuses a redirect into mapped private space", async () => {
      const { lookup, asked } = lookupAnswering(async () => {
        const response = new Response(null, {
          status: 302,
          headers: {
            location:
              "https://[::ffff:169.254.169.254]/latest/meta-data/iam/security-credentials/",
          },
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
      expect(asked).toEqual([URL_UNDER_TEST]);
    });

    it("still reaches a public address wearing the same coat", async () => {
      // The unwrapping must not refuse the whole notation — only what it
      // unwraps to. 8.8.8.8 is public however it is spelled.
      const { lookup, asked } = lookupAnswering(async () =>
        respond(200, "lw-token-123"),
      );

      const result = await lookup.fetchVerificationFile({
        domain: "acme.com",
        url: "https://[::ffff:808:808]/.well-known/langwatch-verification.txt",
      });

      expect(result).toEqual({ outcome: "served", values: ["lw-token-123"] });
      expect(asked).toHaveLength(1);
    });

    it("still reaches an ordinary public IPv6 address", async () => {
      const { lookup } = lookupAnswering(async () =>
        respond(200, "lw-token-123"),
      );

      expect(
        await lookup.fetchVerificationFile({
          domain: "acme.com",
          url: "https://[2606:4700:4700::1111]/.well-known/langwatch-verification.txt",
        }),
      ).toEqual({ outcome: "served", values: ["lw-token-123"] });
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

/** A real redirect, the way the customer's web server sends one. */
function redirectTo(location: string): Response {
  const response = new Response(null, {
    status: 302,
    headers: { location },
  });
  Object.defineProperty(response, "url", { value: URL_UNDER_TEST });
  return response;
}
