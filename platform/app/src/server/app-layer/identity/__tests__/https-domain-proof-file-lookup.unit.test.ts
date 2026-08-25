import { describe, expect, it } from "vitest";
import { HttpsDomainProofFileLookup } from "../sso-self-serve-adapters";

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
  return { lookup: new HttpsDomainProofFileLookup(fetchImpl), asked };
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
function respond(status: number, body: string, url = URL_UNDER_TEST): Response {
  const response = new Response(status === 204 ? null : body, { status });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
