/**
 * @vitest-environment node
 * The collector's credential names the key behind it, for the request's access record.
 * Spec: specs/observability/request-log-client-and-principal.feature
 */
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceIngestCredentialService } from "../trace-ingest-credential.service.ts";

const PROJECT = { id: "project-1", teamId: "team-1", organizationId: "organization-1" };

function keyResolvedAs(resolved: ResolvedApiKeyCredential) {
  const credentials = TraceIngestCredentialService.create({
    apiKeys: { findResolvedToken: vi.fn().mockResolvedValue(resolved), markUsed: vi.fn() },
    authz: { hasApiKeyPermission: vi.fn().mockResolvedValue(true) },
    sourceBilling: { receiverPolicies: vi.fn() },
  });
  const request = new Request("http://localhost/api/collector", {
    method: "POST",
    headers: { "X-Auth-Token": "sk-lw-marker" },
  });

  return credentials.resolveForCollector({ request }).then((credential) => credential.key);
}

function apiKey(overrides: Partial<Extract<ResolvedApiKeyCredential, { type: "apiKey" }>>) {
  return {
    type: "apiKey",
    apiKeyId: "key_1",
    userId: "user_1",
    organizationId: PROJECT.organizationId,
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
    ...overrides,
  } as ResolvedApiKeyCredential;
}

describe("the collector credential's key", () => {
  it("names an API key by its id, kind and owner", async () => {
    expect(await keyResolvedAs(apiKey({}))).toEqual({
      kind: "api_key",
      apiKeyId: "key_1",
      ownerUserId: "user_1",
    });
  });

  it("names a key with a source type and no template an ingestion key", async () => {
    expect(await keyResolvedAs(apiKey({ ingestSourceType: "otel" }))).toMatchObject({
      kind: "ingestion_key",
    });
  });

  it("names the legacy project key by its kind alone", async () => {
    expect(
      await keyResolvedAs({
        type: "legacyProjectKey",
        project: PROJECT,
      } as ResolvedApiKeyCredential),
    ).toEqual({ kind: "legacy_project_key", apiKeyId: null, ownerUserId: null });
  });
});
