import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKey } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { LegacyApiKeyGrantService } from "../legacy-api-key-grant.service.ts";

const CREATED_AT = new Date("2024-03-01T10:00:00.000Z");
const CUTOVER_AT = new Date("2024-06-01T00:00:00.000Z");
const CUTOVER_INSTANT = fromDate(CUTOVER_AT);

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

function harness(
  options: {
    cutoverAt?: Date | null;
    now?: () => number;
    attachBindings?: ReturnType<typeof vi.fn<AuthzApi["attachBindings"]>>;
  } = {},
) {
  const findEngineCutoverAt = vi
    .fn()
    .mockResolvedValue(options.cutoverAt === undefined ? CUTOVER_INSTANT : options.cutoverAt);
  const attachBindings =
    options.attachBindings ??
    vi.fn<AuthzApi["attachBindings"]>().mockResolvedValue({ attached: [], duplicates: [] });
  const { logger, lines } = createTestLogger();
  const service = LegacyApiKeyGrantService.create({
    authz: createApiFixture<AuthzApi>({ findEngineCutoverAt }),
    grants: createApiFixture<AuthzApi>({ attachBindings }),
    deriveBindingId: () => "grant-derived",
    diagnostics: logger,
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, findEngineCutoverAt, attachBindings, lines };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LegacyApiKeyGrantService", () => {
  /** @scenario "The mint never holds up the request that triggered it" */
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

  /** @scenario "A key that is busy authenticating mints once, not once per request" */
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

  // @scenario A key born during a parked genesis import still mints once the organization migrates
  it("retries after the organization reaches finalized cutover", async () => {
    const { service, findEngineCutoverAt, attachBindings } = harness({
      cutoverAt: null,
    });

    service.mint(apiKey());
    await settle();
    expect(attachBindings).not.toHaveBeenCalled();

    findEngineCutoverAt.mockResolvedValue(CUTOVER_INSTANT);
    service.mint(apiKey());
    await settle();
    expect(attachBindings).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A key that already states its access mints nothing" */
  /** @scenario "A key owned by a user mints nothing it did not already have" */
  it.each([
    ["created at cutover", apiKey({ createdAt: CUTOVER_AT })],
    ["already bound", apiKey({ roleBindings: [{ id: "binding-1" }] as ApiKey["roleBindings"] })],
    ["user owned", apiKey({ userId: "user-1" })],
    ["ingestion", apiKey({ ingestSourceType: "claude_code" })],
  ])("does not widen a %s key", async (_label, key) => {
    const { service, attachBindings } = harness();
    service.mint(key);
    await settle();
    expect(attachBindings).not.toHaveBeenCalled();
  });

  /**
   * @scenario "A mint that fails leaves the credential working"
   * @scenario "An API-key grant warning reaches the process logger"
   */
  it("swallows a failed write, reports it, and lets the next request retry", async () => {
    const attachBindings = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue down"))
      .mockResolvedValue({ attached: [], duplicates: [] });
    const { service, lines } = harness({ attachBindings });

    expect(() => service.mint(apiKey())).not.toThrow();
    await settle();
    service.mint(apiKey());
    await settle();

    expect(attachBindings).toHaveBeenCalledTimes(2);
    const warnings = lines.filter((line) => line.level === 40);
    expect(warnings).toHaveLength(1);
    expect(lines.findLine("warn", "failed to mint the legacy API key grant")).toMatchObject({
      apiKeyId: expect.any(String),
    });
  });
});

describe("legacy API-key grant facts", () => {
  it("uses a strict before-cutover boundary", () => {
    expect(
      LegacyApiKeyGrantService.keyPredatesAuthzEngine({
        apiKey: apiKey(),
        cutoverAt: fromDate(CUTOVER_AT),
      }),
    ).toBe(true);
    expect(
      LegacyApiKeyGrantService.keyPredatesAuthzEngine({
        apiKey: apiKey({ createdAt: CUTOVER_AT }),
        cutoverAt: fromDate(CUTOVER_AT),
      }),
    ).toBe(false);
  });

  it("derives a stable identity from the fact", () => {
    const derive = vi.fn(() => "grant-derived");
    expect(LegacyApiKeyGrantService.findLegacyGrantForApiKey(apiKey(), derive)?.bindingId).toBe(
      "grant-derived",
    );
    expect(derive).toHaveBeenCalledWith({
      organizationId: "org-1",
      principal: { type: "apiKey", id: "key-1" },
      scope: { type: "ORGANIZATION", id: "org-1" },
      occurredAtMs: CREATED_AT.getTime(),
    });
  });
});
