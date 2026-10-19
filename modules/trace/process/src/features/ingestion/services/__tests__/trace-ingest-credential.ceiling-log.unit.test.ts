/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-ingest-ceiling-refusal-log.feature
 */
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceIngestCredentialService } from "../trace-ingest-credential.service.ts";

const PROJECT = { id: "project-1", teamId: "team-1", organizationId: "organization-1" };
const WINDOW_MS = 5 * 60_000;

function apiKey(apiKeyId: string): ResolvedApiKeyCredential {
  return {
    type: "apiKey",
    apiKeyId,
    userId: null,
    organizationId: PROJECT.organizationId,
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  } as ResolvedApiKeyCredential;
}

function refusingDoor() {
  let now = 1_000_000;
  const logger = { error: vi.fn(), warn: vi.fn() };
  const service = TraceIngestCredentialService.create({
    apiKeys: {
      findResolvedToken: vi.fn(({ token }: { token: string }) => Promise.resolve(apiKey(token))),
      markUsed: vi.fn(),
    },
    authz: { hasApiKeyPermission: vi.fn().mockResolvedValue(false) },
    sourceBilling: { receiverPolicies: vi.fn() },
    logger,
    now: () => now,
  });
  const send = (keyId: string) =>
    service.resolveForOtlp({
      authorization: `Bearer ${keyId}`,
      xAuthToken: null,
      xProjectId: null,
    });
  const advance = (ms: number) => {
    now += ms;
  };
  return { logger, send, advance };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? null;
  }
};

describe("TraceIngestCredentialService ceiling refusal log", () => {
  describe("when a key without traces:create sends a batch", () => {
    /** @scenario "A ceiling refusal is logged as a warning, not an error" */
    it("refuses it and warns once without an error line", async () => {
      const { logger, send } = refusingDoor();

      expect(await codeOf(send("key-a"))).toBe("api_key_permission_denied");

      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        apiKeyId: "key-a",
        projectId: PROJECT.id,
        permission: "traces:create",
        suppressedRefusals: 0,
      });
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("when the same key is refused five times inside one window", () => {
    /** @scenario "Repeated refusals for one key inside the window log a single line" */
    it("refuses every batch and logs only the first", async () => {
      const { logger, send, advance } = refusingDoor();

      for (let attempt = 0; attempt < 5; attempt++) {
        expect(await codeOf(send("key-a"))).toBe("api_key_permission_denied");
        advance(1_000);
      }

      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });

  describe("when the window passes after four held-back refusals", () => {
    /** @scenario "The next line after the window carries the count of refusals held back" */
    it("logs the next refusal with the suppressed count", async () => {
      const { logger, send, advance } = refusingDoor();
      for (let attempt = 0; attempt < 5; attempt++) await codeOf(send("key-a"));

      advance(WINDOW_MS);
      await codeOf(send("key-a"));

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn.mock.calls[1]?.[0]).toMatchObject({
        apiKeyId: "key-a",
        suppressedRefusals: 4,
      });
    });
  });

  describe("when two keys are refused inside one window", () => {
    /** @scenario "Refusals for different keys are sampled independently" */
    it("logs each key's first refusal", async () => {
      const { logger, send } = refusingDoor();

      await codeOf(send("key-a"));
      await codeOf(send("key-b"));
      await codeOf(send("key-a"));

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn.mock.calls.map((call) => call[0].apiKeyId)).toEqual(["key-a", "key-b"]);
    });
  });
});
