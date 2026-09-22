import type { SsrfUrlValidator, SsrfValidationResult } from "@langwatch/egress";
import { RedirectRefusedError } from "@langwatch/egress";
import { describe, expect, it } from "vitest";

import {
  type DiscoveryResponse,
  type FencedDiscoveryFetch,
  HttpsSsoIssuerDiscoveryChannel,
} from "../http/http.sso-issuer-discovery.channel.ts";
import { MemorySsoIssuerDiscoveryChannel } from "../memory/memory.sso-issuer-discovery.channel.ts";

/**
 * Asking an issuer whether it is one (D09). The fence is injected, so no
 * test here opens a socket — and the guard that refuses a name resolving
 * into private space is the half worth asserting.
 */

const ISSUER = "https://login.acme.okta.com/";
const ENDPOINT = "https://login.acme.okta.com/.well-known/openid-configuration";
const POLICY = { blockLocal: true, allowedHosts: [], verifyTls: true } as const;

const DISCOVERY_DOCUMENT = {
  issuer: "https://login.acme.okta.com",
  authorization_endpoint: "https://login.acme.okta.com/oauth2/v1/authorize",
  token_endpoint: "https://login.acme.okta.com/oauth2/v1/token",
};

function respond(status: number, document: unknown): DiscoveryResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => document,
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
  answer: () => Promise<DiscoveryResponse>,
  validate: SsrfUrlValidator = async (url) => admitted(url),
): { channel: HttpsSsoIssuerDiscoveryChannel; asked: string[] } {
  const asked: string[] = [];
  const fetchValidated: FencedDiscoveryFetch = async (validated) => {
    asked.push(validated.originalUrl);

    return answer();
  };

  return {
    channel: HttpsSsoIssuerDiscoveryChannel.create({ policy: POLICY, validate, fetchValidated }),
    asked,
  };
}

describe("given an issuer an administrator typed", () => {
  it("reads the well-known document under the issuer, trailing slash and all", async () => {
    const { channel, asked } = channelAnswering(async () => respond(200, DISCOVERY_DOCUMENT));

    await expect(channel.discover({ issuer: ISSUER })).resolves.toEqual({ reachable: true });
    expect(asked).toEqual([ENDPOINT]);
  });

  it("keeps the path a multi-tenant issuer carries", async () => {
    const { channel, asked } = channelAnswering(async () => respond(200, DISCOVERY_DOCUMENT));

    await channel.discover({ issuer: "https://login.example.com/t/acme" });

    expect(asked).toEqual(["https://login.example.com/t/acme/.well-known/openid-configuration"]);
  });

  it("refuses an address that is not https, before a socket opens", async () => {
    const { channel, asked } = channelAnswering(async () => respond(200, DISCOVERY_DOCUMENT));

    await expect(channel.discover({ issuer: "http://login.acme.test" })).resolves.toEqual({
      reachable: false,
      reason: "not_https",
    });
    expect(asked).toEqual([]);
  });

  it("says nothing about where a refused name resolved", async () => {
    const { channel } = channelAnswering(
      async () => respond(200, DISCOVERY_DOCUMENT),
      async () => {
        throw new Error("169.254.169.254 is link-local and will not be dialled");
      },
    );

    await expect(channel.discover({ issuer: "https://metadata.acme.test" })).resolves.toEqual({
      reachable: false,
      reason: "host_refused",
    });
  });

  it("names a refused redirect as itself", async () => {
    const { channel } = channelAnswering(async () => {
      throw new RedirectRefusedError("a hop left the public internet");
    });

    await expect(channel.discover({ issuer: ISSUER })).resolves.toEqual({
      reachable: false,
      reason: "redirect_refused",
    });
  });

  /** @scenario "An issuer that cannot be reached is refused in the customer's words" */
  it("carries the status of an issuer that answered something else", async () => {
    const { channel } = channelAnswering(async () => respond(404, {}));

    await expect(channel.discover({ issuer: ISSUER })).resolves.toEqual({
      reachable: false,
      reason: "answered 404",
    });
  });

  it("refuses a document with no endpoints to dial, however well it answered", async () => {
    const { channel } = channelAnswering(async () =>
      respond(200, { issuer: "https://login.acme.okta.com" }),
    );

    await expect(channel.discover({ issuer: ISSUER })).resolves.toEqual({
      reachable: false,
      reason: "answered something else",
    });
  });
});

describe("the memory twin", () => {
  it("answers what a test seeded, and refuses an address nobody seeded", async () => {
    const discovery = MemorySsoIssuerDiscoveryChannel.create();
    discovery.seedReachable({ issuer: ISSUER });

    await expect(discovery.discover({ issuer: ISSUER })).resolves.toEqual({ reachable: true });
    await expect(discovery.discover({ issuer: "https://nobody.test" })).resolves.toEqual({
      reachable: false,
      reason: "host_refused",
    });
    expect(discovery.asked).toEqual([ISSUER, "https://nobody.test"]);
  });
});
