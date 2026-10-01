import type { SsrfUrlValidator, SsrfValidationResult } from "@langwatch/egress";
import { RedirectRefusedError } from "@langwatch/egress";
import { describe, expect, it } from "vitest";

import {
  type FencedProofFetch,
  HttpsSsoDomainProofFileChannel,
  type ProofFileResponse,
} from "../http/http.sso-domain-proof-file.channel.ts";
import { MemorySsoDomainProofFileChannel } from "../memory/memory.sso-domain-proof-file.channel.ts";

/**
 * Telling "nothing is served there" apart from "we could not read it"
 * (specs/identity/sso-domain-verification.feature, the file channel). The
 * fence is injected, so no test here opens a socket.
 */

const URL_UNDER_TEST = "https://acme.com/.well-known/langwatch-verification.txt";

const POLICY = { blockLocal: true, allowedHosts: [], verifyTls: true } as const;

function respond(status: number, body: string): ProofFileResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    body: null,
  };
}

/** A destination the fence admitted, as `fetchValidatedDestination` takes it. */
function admitted(url: string): SsrfValidationResult {
  const parsed = new URL(url);

  return {
    type: "resolved",
    originalUrl: url,
    hostname: parsed.hostname,
    port: 443,
    protocol: parsed.protocol,
    path: parsed.pathname,
    resolvedIp: "93.184.216.34",
  };
}

function channelAnswering(
  answer: (init: Parameters<FencedProofFetch>[1]) => Promise<ProofFileResponse>,
  validate: SsrfUrlValidator = async (url) => admitted(url),
): { channel: HttpsSsoDomainProofFileChannel; asked: string[] } {
  const asked: string[] = [];
  const fetchValidated: FencedProofFetch = async (validated, init) => {
    asked.push(validated.originalUrl);

    return answer(init);
  };

  return {
    channel: HttpsSsoDomainProofFileChannel.create({
      policy: POLICY,
      validate,
      fetchValidated,
    }),
    asked,
  };
}

const fetchFile = (channel: HttpsSsoDomainProofFileChannel) =>
  channel.fetchVerificationFile({ domain: "acme.com", url: URL_UNDER_TEST });

describe("given a fetch of the verification file", () => {
  describe("when the domain serves the file", () => {
    /** @scenario "Serving the file proves the domain through the same ceremony" */
    it("answers the non-empty lines, trimmed", async () => {
      const { channel, asked } = channelAnswering(async () => respond(200, "  lw-token-123  \n\n"));

      expect(await fetchFile(channel)).toEqual({ outcome: "served", values: ["lw-token-123"] });
      expect(asked).toEqual([URL_UNDER_TEST]);
    });

    /** @scenario "A file that is not served yet is not a failed proof" */
    it("answers absent for a file with nothing in it", async () => {
      const { channel } = channelAnswering(async () => respond(200, "\n \n"));

      expect(await fetchFile(channel)).toEqual({ outcome: "absent" });
    });
  });

  describe("when the domain says the file is not there", () => {
    /** @scenario "A file that is not served yet is not a failed proof" */
    it("answers absent for a clean not-found", async () => {
      const { channel } = channelAnswering(async () => respond(404, "not here"));

      expect(await fetchFile(channel)).toEqual({ outcome: "absent" });
    });
  });

  describe("when the fetch cannot be answered", () => {
    /** @scenario "A fetch that could not happen says so, and blames nobody" */
    it("classifies a server error as unreachable, never as absent", async () => {
      const { channel } = channelAnswering(async () => respond(503, "down"));

      expect(await fetchFile(channel)).toEqual({ outcome: "unreachable", reason: "http_503" });
    });

    /** @scenario "A fetch that could not happen says so, and blames nobody" */
    it("classifies a refused connection as unreachable", async () => {
      const { channel } = channelAnswering(async () => {
        throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
      });

      expect(await fetchFile(channel)).toEqual({
        outcome: "unreachable",
        reason: "ECONNREFUSED",
      });
    });

    /** @scenario "A fetch that could not happen says so, and blames nobody" */
    it("refuses a body too large to be the token", async () => {
      const { channel } = channelAnswering(async () => respond(200, "x".repeat(70 * 1024)));

      expect(await fetchFile(channel)).toEqual({
        outcome: "unreachable",
        reason: "file_too_large",
      });
    });
  });

  describe("when the journey would leave https", () => {
    /** @scenario "A token read off https proves nothing" */
    it("refuses a hop the domain redirects onto plain http, before it is dialled", async () => {
      // The refusal comes from the fence judging the hop, not from reading
      // where a followed response says it landed — by then the request we
      // were preventing has already happened.
      const { channel, asked } = channelAnswering(async (init) => {
        await init.revalidate?.("http://acme.com/verification.txt");

        return respond(200, "lw-token-123");
      });

      expect(await fetchFile(channel)).toEqual({ outcome: "unreachable", reason: "not_https" });
      expect(asked).toEqual([URL_UNDER_TEST]);
    });

    /** @scenario "A token read off https proves nothing" */
    it("never dials a verification url that is not https to begin with", async () => {
      const { channel, asked } = channelAnswering(async () => respond(200, "lw-token-123"));

      expect(
        await channel.fetchVerificationFile({
          domain: "acme.com",
          url: "http://acme.com/.well-known/langwatch-verification.txt",
        }),
      ).toEqual({ outcome: "unreachable", reason: "not_https" });
      expect(asked).toEqual([]);
    });

    /** @scenario "A fetch that could not happen says so, and blames nobody" */
    it("reports a refused redirect as its own reason", async () => {
      const { channel } = channelAnswering(async () => {
        throw new RedirectRefusedError();
      });

      expect(await fetchFile(channel)).toEqual({
        outcome: "unreachable",
        reason: "redirect_refused",
      });
    });
  });

  describe("when the fence turns the destination away", () => {
    /** @scenario "A fetch that could not happen says so, and blames nobody" */
    it("never opens a socket to a host the policy refused, nor to one that will not resolve", async () => {
      for (const refusal of ['Unable to resolve hostname "acme.com".', "Blocked private address"]) {
        const { channel, asked } = channelAnswering(
          async () => respond(200, "lw-token-123"),
          async () => {
            throw new Error(refusal);
          },
        );

        expect(await fetchFile(channel)).toEqual({
          outcome: "unreachable",
          reason: "host_refused",
        });
        expect(asked).toEqual([]);
      }
    });
  });
});

describe("given the memory twin of the file channel", () => {
  /** @scenario "Serving the file proves the domain through the same ceremony" */
  it("answers what a test seeded, and absent for a url nothing seeded", async () => {
    const channel = MemorySsoDomainProofFileChannel.create();
    channel.seedServed({ url: URL_UNDER_TEST, values: ["lw-token-123"] });

    expect(
      await channel.fetchVerificationFile({ domain: "acme.com", url: URL_UNDER_TEST }),
    ).toEqual({ outcome: "served", values: ["lw-token-123"] });
    expect(
      await channel.fetchVerificationFile({
        domain: "quiet.example",
        url: "https://quiet.example/.well-known/langwatch-verification.txt",
      }),
    ).toEqual({ outcome: "absent" });
    expect(channel.asked).toHaveLength(2);
  });
});
