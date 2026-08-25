import type { ApiKey } from "@langwatch/api-key-contract";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import { ApiKeyDiagnosticsPort } from "../src/ports/api-key-diagnostics.port";
import {
  LegacyApiKeyGrantService,
  keyPredatesAuthzEngine,
  legacyGrantForApiKey,
} from "../src/services/legacy-api-key-grant.service";

const CREATED_AT = new Date("2024-03-01T10:00:00.000Z");
const CUTOVER_AT = new Date("2024-06-01T00:00:00.000Z");

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "key-1",
    name: "deploy bot",
    description: null,
    lookupId: "lookup",
    permissionMode: "all",
    userId: null,
    createdByUserId: null,
    createdByDeviceLabel: null,
    organizationId: "org-1",
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    roleBindings: [],
    ...overrides,
  };
}

class RecordingDiagnostics extends ApiKeyDiagnosticsPort {
  readonly warnings: Array<{
    context: Record<string, unknown>;
    message: string;
  }> = [];

  warn(context: Record<string, unknown>, message: string): void {
    this.warnings.push({ context, message });
  }
}

function harness(
  options: {
    cutoverAt?: Date | null;
    now?: () => number;
    attachBindings?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const tryGetEngineCutoverAt = vi
    .fn()
    .mockResolvedValue(options.cutoverAt === undefined ? CUTOVER_AT : options.cutoverAt);
  const attachBindings =
    options.attachBindings ?? vi.fn().mockResolvedValue({ attached: [], duplicates: [] });
  const diagnostics = new RecordingDiagnostics();
  const service = LegacyApiKeyGrantService.create({
    authz: { tryGetEngineCutoverAt } as unknown as AuthzService,
    grants: { attachBindings } as unknown as AuthzGrantsService,
    deriveBindingId: () => "grant-derived",
    diagnostics,
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, tryGetEngineCutoverAt, attachBindings, diagnostics };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LegacyApiKeyGrantService", () => {
  it("writes the pre-cutover service key fact without blocking authentication", async () => {
    const { service, attachBindings } = harness();

    expect(() => service.mint(apiKey())).not.toThrow();
    await settle();

    expect(attachBindings).toHaveBeenCalledWith({
      organizationId: "org-1",
      bindings: [
        {
          bindingId: "grant-derived",
          principal: { apiKeyId: "key-1" },
          role: "ADMIN",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
        },
      ],
      actor: { type: "system", id: "system:read-through-mint" },
      source: "read-through-mint",
      onDuplicate: "skip",
      commandId: "read-through-mint:key-1",
      occurredAtMs: CREATED_AT.getTime(),
      awaitProjection: false,
    });
  });

  it("deduplicates hot requests but retries after the bounded note expires", async () => {
    let now = 1_000;
    const { service, attachBindings } = harness({ now: () => now });

    service.mint(apiKey());
    service.mint(apiKey());
    await settle();
    expect(attachBindings).toHaveBeenCalledTimes(1);

    now += 61_000;
    service.mint(apiKey());
    await settle();
    expect(attachBindings).toHaveBeenCalledTimes(2);
  });

  it("retries after the organization reaches finalized cutover", async () => {
    const { service, tryGetEngineCutoverAt, attachBindings } = harness({
      cutoverAt: null,
    });

    service.mint(apiKey());
    await settle();
    expect(attachBindings).not.toHaveBeenCalled();

    tryGetEngineCutoverAt.mockResolvedValue(CUTOVER_AT);
    service.mint(apiKey());
    await settle();
    expect(attachBindings).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["created at cutover", apiKey({ createdAt: CUTOVER_AT })],
    [
      "already bound",
      apiKey({ roleBindings: [{ id: "binding-1" }] as ApiKey["roleBindings"] }),
    ],
    ["user owned", apiKey({ userId: "user-1" })],
    ["ingestion", apiKey({ ingestSourceType: "claude_code" })],
  ])("does not widen a %s key", async (_label, key) => {
    const { service, attachBindings } = harness();
    service.mint(key);
    await settle();
    expect(attachBindings).not.toHaveBeenCalled();
  });

  it("swallows a failed write, reports it, and lets the next request retry", async () => {
    const attachBindings = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue down"))
      .mockResolvedValue({ attached: [], duplicates: [] });
    const { service, diagnostics } = harness({ attachBindings });

    expect(() => service.mint(apiKey())).not.toThrow();
    await settle();
    service.mint(apiKey());
    await settle();

    expect(attachBindings).toHaveBeenCalledTimes(2);
    expect(diagnostics.warnings).toHaveLength(1);
  });
});

describe("legacy API-key grant facts", () => {
  it("uses a strict before-cutover boundary", () => {
    expect(keyPredatesAuthzEngine({ apiKey: apiKey(), cutoverAt: CUTOVER_AT })).toBe(
      true,
    );
    expect(
      keyPredatesAuthzEngine({
        apiKey: apiKey({ createdAt: CUTOVER_AT }),
        cutoverAt: CUTOVER_AT,
      }),
    ).toBe(false);
  });

  it("derives a stable identity from the fact", () => {
    const derive = vi.fn(() => "grant-derived");
    expect(legacyGrantForApiKey(apiKey(), derive)?.bindingId).toBe("grant-derived");
    expect(derive).toHaveBeenCalledWith({
      organizationId: "org-1",
      principal: { type: "apiKey", id: "key-1" },
      scope: { type: "ORGANIZATION", id: "org-1" },
      occurredAtMs: CREATED_AT.getTime(),
    });
  });
});
