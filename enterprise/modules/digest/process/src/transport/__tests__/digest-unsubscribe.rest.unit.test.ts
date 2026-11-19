// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The digest's public unsubscribe address through the real REST runtime: every page refuses to
 * be framed, and a missing signing secret answers as a handled refusal, not a server fault.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import {
  type DigestApi,
  DigestLinksUnavailableError,
} from "@langwatch/enterprise-digest-contract";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { digestUnsubscribeRest } from "../digest-unsubscribe.rest.ts";

const TOKEN = "payload.signature";

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
    app: () => app as DigestApi,
    credential: "public",
    onError: canonicalErrorResponse,
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
      expect(await response.text()).toContain("<form method=\"post\"");
    });
  });

  describe("when no signing secret is configured", () => {
    /** @scenario "Without a signing secret no link is signed or honoured" */
    it.each([
      ["GET", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/unsubscribe"],
      ["POST", "/api/digest/resubscribe"],
    ] as const)("%s %s answers 503 with the unavailable code", async (method, path) => {
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
      expect(await response.json()).toMatchObject({ code: "digest_links_unavailable" });
    });
  });
});
