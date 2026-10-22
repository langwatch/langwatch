/** @vitest-environment node */

import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TraceIngestCredentialService } from "../trace-ingest-credential.service.ts";
import type { TraceIngestSourceBillingService } from "../trace-ingest-source-billing.service.ts";

const TTL_MS = 10_000;

function door() {
  let now = 1_000_000;
  const findResolvedToken = vi.fn(() => Promise.resolve(null));
  const service = TraceIngestCredentialService.create({
    apiKeys: createApiFixture<Pick<ApiKeyApi, "findResolvedToken" | "markUsed">>({
      findResolvedToken,
    }),
    authz: createApiFixture<Pick<AuthzApi, "hasApiKeyPermission">>(),
    sourceBilling: createApiFixture<Pick<TraceIngestSourceBillingService, "receiverPolicies">>(),
    now: () => now,
  });
  const send = (token: string, xProjectId: string | null = null) =>
    service
      .resolveForOtlp({ authorization: `Bearer ${token}`, xAuthToken: null, xProjectId })
      .catch((error: { code?: string }) => error.code);
  return { send, findResolvedToken, advance: (ms: number) => void (now += ms) };
}

describe("TraceIngestCredentialService unknown tokens", () => {
  describe("when the same unknown token is sent repeatedly", () => {
    /** @scenario An unknown ingest token is not looked up again for ten seconds */
    it("asks the directory once and refuses every repeat as invalid", async () => {
      const { send, findResolvedToken } = door();

      const codes = [await send("bad"), await send("bad"), await send("bad")];

      expect(codes).toEqual(["invalid_credentials", "invalid_credentials", "invalid_credentials"]);
      expect(findResolvedToken).toHaveBeenCalledTimes(1);
    });

    /** @scenario An unknown ingest token is looked up again once its memory expires */
    it("asks again once the memory expires", async () => {
      const { send, findResolvedToken, advance } = door();

      await send("bad");
      advance(TTL_MS + 1);
      await send("bad");

      expect(findResolvedToken).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a different token or project is sent", () => {
    /** @scenario A different unknown token or project is looked up on its own */
    it("is looked up on its own", async () => {
      const { send, findResolvedToken } = door();

      await send("bad-1");
      await send("bad-2");
      await send("bad-1", "project-x");

      expect(findResolvedToken).toHaveBeenCalledTimes(3);
    });
  });
});
