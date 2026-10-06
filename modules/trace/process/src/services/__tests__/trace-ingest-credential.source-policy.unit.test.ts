/**
 * @vitest-environment node
 * The OTLP receiver's credential carries trace's source policy for an ingestion-source key.
 * Spec: specs/server/otlp-receiver-policy.feature
 */
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryTraceIngestSourceBillingRepository } from "../../repositories/memory/memory.trace-ingest-source-billing.repository.ts";
import { TraceIngestCredentialService } from "../trace-ingest-credential.service.ts";
import { TraceIngestSourceBillingService } from "../trace-ingest-source-billing.service.ts";

const PROJECT = { id: "project-1", teamId: "team-1", organizationId: "organization-1" };
const NON_BILLABLE = "langwatch.cost.non_billable";

function ingestionKey(ingestSourceType: string | null): ResolvedApiKeyCredential {
  return {
    type: "apiKey",
    apiKeyId: "key_real",
    userId: null,
    organizationId: PROJECT.organizationId,
    ingestSourceType,
    ingestionTemplateId: ingestSourceType ? "template-1" : null,
    project: PROJECT,
  } as ResolvedApiKeyCredential;
}

function door(resolved: ResolvedApiKeyCredential) {
  const repository = MemoryTraceIngestSourceBillingRepository.create();
  const billing = TraceIngestSourceBillingService.create({ repository });
  const credentials = TraceIngestCredentialService.create({
    apiKeys: { findResolvedToken: vi.fn().mockResolvedValue(resolved), markUsed: vi.fn() },
    authz: { hasApiKeyPermission: vi.fn().mockResolvedValue(true) },
    sourceBilling: billing,
  });
  const resolve = () =>
    credentials.resolveForOtlp({
      authorization: "Bearer sk-lw-marker",
      xAuthToken: null,
      xProjectId: null,
    });
  return { billing, resolve };
}

function markerOf(attributes: readonly { key: string; value: unknown }[] | undefined) {
  return attributes?.find((attribute) => attribute.key === NON_BILLABLE)?.value;
}

describe("TraceIngestCredentialService.resolveForOtlp", () => {
  describe("given an ingestion-source key whose source trace has no billing row for", () => {
    it("is admitted with a ready policy stamped non-billable", async () => {
      const { resolve } = door(ingestionKey("copilot_vscode"));

      const { identity } = await resolve();

      expect(identity.sourcePolicy?.status).toBe("ready");
      if (identity.sourcePolicy?.status !== "ready") return;
      const { traces, logs, metrics } = identity.sourcePolicy.policies;
      expect(markerOf(traces.resourceAttributes)).toEqual({ stringValue: "true" });
      expect(markerOf(logs.resourceAttributes)).toEqual({ stringValue: "true" });
      expect(markerOf(metrics.resourceAttributes)).toBeUndefined();
      expect(traces.resourceAttributes).toContainEqual({
        key: "langwatch.template.id",
        value: { stringValue: "template-1" },
      });
    });
  });

  describe("given an ingestion-source key whose source governance billed", () => {
    it("stamps the marker false from trace's own row", async () => {
      const { billing, resolve } = door(ingestionKey("claude_code"));
      await billing.fold({
        organizationId: PROJECT.organizationId,
        sourceType: "claude_code",
        billed: true,
        recordedAtMs: 100,
      });

      const { identity } = await resolve();

      expect(identity.sourcePolicy?.status).toBe("ready");
      if (identity.sourcePolicy?.status !== "ready") return;
      expect(markerOf(identity.sourcePolicy.policies.traces.resourceAttributes)).toEqual({
        stringValue: "false",
      });
    });
  });

  describe("given a key that is not an ingestion source", () => {
    it("carries no source policy for an ordinary API key", async () => {
      const { identity } = await door(ingestionKey(null)).resolve();

      expect(identity.sourcePolicy).toBeUndefined();
      expect(identity.apiKeyId).toBe("key_real");
    });

    it("carries no source policy for a legacy project key", async () => {
      const { identity } = await door({
        type: "legacyProjectKey",
        project: PROJECT,
      } as ResolvedApiKeyCredential).resolve();

      expect(identity).toEqual({
        apiKeyId: null,
        organizationId: PROJECT.organizationId,
        ingestSourceType: null,
        ingestionTemplateId: null,
      });
    });
  });
});
