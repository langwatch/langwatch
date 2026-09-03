/**
 * The redirect policy the credential probe used to assert on its own fetch call
 * now lives in the egress the composition root hands it, so this is where the
 * scenario binds. Moved from
 * `platform/app/src/server/modelProviders/__tests__/providerValidation.unit.test.ts`.
 *
 * Spec: specs/model-providers/credential-validation.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fencedFetch = vi.fn();
vi.mock("@langwatch/egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/egress")>()),
  createSsrfUrlValidator: () => async (url: string) => {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || "443",
      path: parsed.pathname,
    };
  },
  fetchValidatedDestination: (...args: unknown[]) => fencedFetch(...args),
}));

import { RedirectRefusedError } from "@langwatch/egress";
import { SsrfModelProviderEgressAdapter } from "../ssrf.model-provider-egress.adapter";

const egress = SsrfModelProviderEgressAdapter.create({
  policy: { blockLocal: true, allowedHosts: [], verifyTls: true },
});

describe("SsrfModelProviderEgressAdapter", () => {
  beforeEach(() => {
    fencedFetch.mockReset();
  });

  describe("when a credential probe goes out", () => {
    /** @scenario "A redirect never carries the credential onward" */
    it("refuses to follow a redirect", async () => {
      fencedFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" });

      await egress.fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer sk-test" },
        signal: AbortSignal.timeout(1000),
      });

      // Hop re-validation falls back to the weaker default policy, and a
      // cross-origin redirect strips `Authorization` while carrying
      // `x-api-key`, `x-goog-api-key` and `xi-api-key` through to the new
      // host. A models listing has no need of a redirect.
      expect(fencedFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ followRedirects: false }),
        expect.anything(),
      );
    });

    it("recognises the fence's own refusal type as a redirect refusal", () => {
      expect(egress.isRedirectRefusal(new RedirectRefusedError())).toBe(true);
      expect(egress.isRedirectRefusal(new Error("Connection failed"))).toBe(false);
    });
  });
});
