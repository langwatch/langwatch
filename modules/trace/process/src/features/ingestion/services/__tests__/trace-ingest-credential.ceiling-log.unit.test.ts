/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-ingest-ceiling-refusal-log.feature
 */
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TraceIngestCredentialService } from "../trace-ingest-credential.service.ts";
import type { TraceIngestSourceBillingService } from "../trace-ingest-source-billing.service.ts";

const PROJECT = { id: "project-1", teamId: "team-1", organizationId: "organization-1" };
const WINDOW_MS = 5 * 60_000;
const WARN_LEVEL = 40;
const ERROR_LEVEL = 50;

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
  const { logger, lines } = createTestLogger();
  const service = TraceIngestCredentialService.create({
    apiKeys: createApiFixture<Pick<ApiKeyApi, "findResolvedToken" | "markUsed">>({
      findResolvedToken: ({ token }) => Promise.resolve(apiKey(token)),
    }),
    authz: createApiFixture<Pick<AuthzApi, "hasApiKeyPermission">>({
      hasApiKeyPermission: () => Promise.resolve(false),
    }),
    sourceBilling: createApiFixture<Pick<TraceIngestSourceBillingService, "receiverPolicies">>(),
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
  const warnings = () => lines.filter((line) => line.level === WARN_LEVEL);
  const errors = () => lines.filter((line) => line.level >= ERROR_LEVEL);
  return { warnings, errors, send, advance };
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
      const { warnings, errors, send } = refusingDoor();

      expect(await codeOf(send("key-a"))).toBe("api_key_permission_denied");

      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toMatchObject({
        apiKeyId: "key-a",
        projectId: PROJECT.id,
        permission: "traces:create",
        suppressedRefusals: 0,
      });
      expect(errors()).toEqual([]);
    });
  });

  describe("when the same key is refused five times inside one window", () => {
    /** @scenario "Repeated refusals for one key inside the window log a single line" */
    it("refuses every batch and logs only the first", async () => {
      const { warnings, send, advance } = refusingDoor();

      for (let attempt = 0; attempt < 5; attempt++) {
        expect(await codeOf(send("key-a"))).toBe("api_key_permission_denied");
        advance(1_000);
      }

      expect(warnings()).toHaveLength(1);
    });
  });

  describe("when the window passes after four held-back refusals", () => {
    /** @scenario "The next line after the window carries the count of refusals held back" */
    it("logs the next refusal with the suppressed count", async () => {
      const { warnings, send, advance } = refusingDoor();
      for (let attempt = 0; attempt < 5; attempt++) await codeOf(send("key-a"));

      advance(WINDOW_MS);
      await codeOf(send("key-a"));

      expect(warnings()).toHaveLength(2);
      expect(warnings()[1]).toMatchObject({
        apiKeyId: "key-a",
        suppressedRefusals: 4,
      });
    });
  });

  describe("when two keys are refused inside one window", () => {
    /** @scenario "Refusals for different keys are sampled independently" */
    it("logs each key's first refusal", async () => {
      const { warnings, send } = refusingDoor();

      await codeOf(send("key-a"));
      await codeOf(send("key-b"));
      await codeOf(send("key-a"));

      expect(warnings().map((line) => line.apiKeyId)).toEqual(["key-a", "key-b"]);
    });
  });
});
