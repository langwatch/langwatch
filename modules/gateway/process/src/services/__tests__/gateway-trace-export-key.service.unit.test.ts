import {
  type ApiKeyApi,
  type CreateApiKeyInput,
  TRACE_EXPORT_API_KEY_NAME,
} from "@langwatch/api-key-contract";
/**
 * The key a gateway trace project's spans are exported with.
 * Spec: specs/ai-gateway/governance/vk-config-bundle.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryGatewayTraceExportKeyRepository } from "../../repositories/memory/memory.gateway-trace-export-key.repository.ts";
import { GatewayTraceExportKeyService } from "../gateway-trace-export-key.service.ts";

function harness() {
  const minted: CreateApiKeyInput[] = [];
  const create = vi.fn();
  create.mockImplementation(async (input: CreateApiKeyInput) => {
    minted.push(input);
    return { token: `sk-lw-key-${minted.length}`, apiKey: { id: `key-${minted.length}` } };
  });
  const apiKeys = createApiFixture<ApiKeyApi>({ create });
  const repository = MemoryGatewayTraceExportKeyRepository.create();
  const service = GatewayTraceExportKeyService.create({ repository, apiKeys });
  return { minted, repository, service };
}

const project = { organizationId: "org-1", projectId: "proj-1" };

describe("the gateway trace export key", () => {
  /** @scenario "The bundle exports spans with a trace-export key, never the project key" */
  it("is an ownerless, hidden key holding only traces:create on its project", async () => {
    const { minted, service } = harness();

    expect(await service.tokenFor(project)).toBe("sk-lw-key-1");

    expect(minted).toEqual([
      expect.objectContaining({
        name: TRACE_EXPORT_API_KEY_NAME,
        isSystemManaged: true,
        userId: null,
        permissionMode: "restricted",
        permissions: ["traces:create"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "proj-1" }],
      }),
    ]);
    expect(minted[0]?.expiresAt).toBeUndefined();
  });

  /** @scenario "The bundle exports spans with a trace-export key, never the project key" */
  it("is minted once and stored with its token", async () => {
    const { minted, repository, service } = harness();

    await service.tokenFor(project);
    expect(await service.tokenFor(project)).toBe("sk-lw-key-1");

    expect(minted).toHaveLength(1);
    expect(await repository.findForProject("proj-1")).toEqual([
      { projectId: "proj-1", apiKeyId: "key-1", token: "sk-lw-key-1" },
    ]);
  });

  /** @scenario "The trace-export key moves the bundle's version token" */
  it("names its id for the bundle's version token once minted", async () => {
    const { service } = harness();
    expect(await service.findKeyIds("proj-1")).toEqual([]);

    await service.tokenFor(project);

    expect(await service.findKeyIds("proj-1")).toEqual(["key-1"]);
  });

  it("keeps the first stored key when two mints race", async () => {
    const { repository, service } = harness();
    await repository.saveFirst({
      projectId: "proj-1",
      apiKeyId: "key-elsewhere",
      token: "sk-lw-elsewhere",
    });

    expect(await service.tokenFor(project)).toBe("sk-lw-elsewhere");
  });
});
