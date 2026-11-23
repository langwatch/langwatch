// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The digest's public unsubscribe address through the real REST runtime: every page refuses to
 * be framed, and a missing signing secret answers as a handled refusal, not a server fault.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import {
  bindMiddlewareContext,
  callerAddressContext,
  canonicalErrorResponse,
  createRestRuntime,
} from "@langwatch/api/rest";
import {
  type DigestApi,
  DigestLinksUnavailableError,
  DigestUnsubscribeRateLimitedError,
} from "@langwatch/enterprise-digest-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { digestUnsubscribeRest } from "../digest-unsubscribe.rest.ts";

const TOKEN = "payload.signature";
const CALLER = "203.0.113.7";

/** The address over the slice of the digest a case names; the caller presents no credential. */
function mount(app: Partial<DigestApi>) {
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("a public token route resolves no identity");
      },
    },
  });
  const hono = runtime.mount(digestUnsubscribeRest.router(), {
    app: () => createApiFixture<DigestApi>(app, "DigestApi"),
    credential: "public",
    onError: canonicalErrorResponse,
    middlewareContext: [bindMiddlewareContext(callerAddressContext, () => CALLER)],
  });
  return (method: "GET" | "POST", path: string) =>
    hono.fetch(new Request(`http://api.test${path}?token=${TOKEN}`, { method }));
}

describe("the digest's unsubscribe pages", () => {
  describe("when a page is answered", () => {
    /** @scenario "The unsubscribe page cannot be framed" */
    it.each([
      ["GET", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/resubscribe"],
    ] as const)("%s %s forbids every frame", async (method, path) => {
      const send = mount({
        isSubscribed: async () => true,
        unsubscribe: async () => {},
        resubscribe: async () => {},
      });

      const response = await send(method, path);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=UTF-8");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(await response.text()).toContain('<form method="post"');
    });
  });

  describe("when a page is answered, its address carries a token", () => {
    /** @scenario "The unsubscribe pages are neither cached nor leak their address" */
    it.each([
      ["GET", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/resubscribe"],
    ] as const)("%s %s is not stored and sends no referrer", async (method, path) => {
      const send = mount({
        isSubscribed: async () => true,
        unsubscribe: async () => {},
        resubscribe: async () => {},
      });

      const response = await send(method, path);

      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    });
  });

  describe("when no signing secret is configured", () => {
    /** @scenario "Without a signing secret no link is signed or honoured" */
    it.each([
      ["GET", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/resubscribe"],
    ] as const)("%s %s answers 503, its code masked as a platform fault", async (method, path) => {
      const unavailable = async (): Promise<never> => {
        throw new DigestLinksUnavailableError();
      };
      const send = mount({
        isSubscribed: unavailable,
        unsubscribe: unavailable,
        resubscribe: unavailable,
      });

      const response = await send(method, path);

      expect(response.status).toBe(503);
      // A 5xx the caller did not cause keeps its code off the wire unless it is a transient
      // refusal (TRANSIENT_REFUSAL_CODES); a missing secret is not one, retrying fixes nothing.
      expect(await response.json()).toMatchObject({ code: "internal_error" });
    });
  });

  describe("when a caller is past the limit", () => {
    /** @scenario "The unsubscribe pages are rate limited, and a refused call touches nothing" */
    it.each([
      ["GET", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/resubscribe"],
    ] as const)("%s %s answers 429, naming its code", async (method, path) => {
      const limited = async (): Promise<never> => {
        throw new DigestUnsubscribeRateLimitedError();
      };
      const send = mount({ isSubscribed: limited, unsubscribe: limited, resubscribe: limited });

      const response = await send(method, path);

      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: "digest_unsubscribe_rate_limited" });
    });
  });

  describe("when a page is asked", () => {
    /** @scenario "The unsubscribe pages are rate limited, and a refused call touches nothing" */
    it("hands the app the token and the address the request was counted as", async () => {
      const calls: unknown[] = [];
      const send = mount({
        isSubscribed: async (input) => {
          calls.push(input);
          return true;
        },
      });

      await send("GET", "/api/digest/unsubscribe");

      expect(calls).toEqual([{ token: TOKEN, callerAddress: CALLER }]);
    });
  });
});
