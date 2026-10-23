/**
 * @vitest-environment node
 * A legacy key's once-a-minute project stamp. The credential census tags the request itself
 * (api-key-token-resolution.credential-census.unit.test.ts).
 * @see modules/api-key/specs/request-credential-type.feature
 */
import type * as observabilityModule from "@langwatch/observability";
import { Temporal, type Instant } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { API_KEY_LAST_USED_WINDOW_MS } from "../api-key-last-used.service.ts";
import { ApiKeyTokenResolutionService } from "../api-key-token-resolution.service.ts";

const loggerSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => loggerSpies,
}));

const LEGACY_TOKEN = "sk-lw-legacy-project-key";

const project = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

function serviceWith({ markFails = false }: { markFails?: boolean } = {}) {
  let now: Instant = Temporal.Instant.from("2026-10-22T12:00:00Z");
  const stamps: string[] = [];
  const service = ApiKeyTokenResolutionService.create({
    authz: { listApiKeyBindings: async () => [] },
    repository: {
      findByLookupId: async () => null,
      upgradeHash: async () => undefined,
      findLivenessById: async () => null,
    },
    tokens: {
      findTokenParts: () => null,
      verify: () => "no_match",
      hash: () => "rehashed",
    },
    projects: {
      findIdentity: async () => project,
      findIdByLegacyApiKey: async () => project.id,
      markLegacyApiKeyUsed: async ({ projectId }: { projectId: string }) => {
        stamps.push(projectId);
        if (markFails) throw new Error("write failed");
      },
    },
    legacyGrants: { mint: () => undefined },
    answers: MemoryApiKeyAnswerCacheRepository.create(),
    now: () => now,
  } as never);

  return {
    service,
    stamps,
    advance: (ms: number) => {
      now = now.add({ milliseconds: ms });
    },
  };
}

describe("a legacy key's last use", () => {
  afterEach(() => {
    Object.values(loggerSpies).forEach((spy) => spy.mockClear());
  });

  /** @scenario "A legacy key's use stamps the project at most once a minute" */
  it("stamps a legacy key's project once a minute, and again after", async () => {
    const { service, stamps, advance } = serviceWith();

    await service.findResolvedToken({ token: LEGACY_TOKEN });
    await service.findResolvedToken({ token: LEGACY_TOKEN });
    expect(stamps).toEqual(["project-1"]);

    advance(API_KEY_LAST_USED_WINDOW_MS + 1);
    await service.findResolvedToken({ token: LEGACY_TOKEN });
    expect(stamps).toEqual(["project-1", "project-1"]);
  });

  /** @scenario "A failed stamp does not fail the request" */
  it("still resolves the project when the stamp fails", async () => {
    const { service } = serviceWith({ markFails: true });

    await expect(service.findResolvedToken({ token: LEGACY_TOKEN })).resolves.toMatchObject({
      type: "legacyProjectKey",
      project: { id: "project-1" },
    });
  });

  it("logs a failed stamp under the project id, not as an API key id", async () => {
    const { service } = serviceWith({ markFails: true });

    await service.findResolvedToken({ token: LEGACY_TOKEN });

    await vi.waitFor(() => expect(loggerSpies.warn).toHaveBeenCalled());
    const [fields] = loggerSpies.warn.mock.calls[0] ?? [];
    expect(fields).toMatchObject({ projectId: "project-1" });
    expect(fields).not.toHaveProperty("apiKeyId");
  });
});
