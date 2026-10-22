/**
 * @vitest-environment node
 * Which credential authenticated a request: the span attribute, the log line, and the legacy
 * key's once-a-minute project stamp.
 * @see modules/api-key/specs/request-credential-type.feature
 */
import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  CREDENTIAL_PROJECT_SPAN_ATTRIBUTE,
  CREDENTIAL_TYPE_SPAN_ATTRIBUTE,
} from "@langwatch/api-key-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { context, propagation, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { API_KEY_LAST_USED_WINDOW_MS } from "../api-key-last-used.service.ts";
import { ApiKeyTokenResolutionService } from "../api-key-token-resolution.service.ts";

const CURRENT_TOKEN = `sk-lw-${"a".repeat(16)}_${"b".repeat(48)}`;
const LEGACY_TOKEN = "sk-lw-legacy-project-key";
const UNKNOWN_TOKEN = "not-a-key";

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

function serviceWith({
  name = "a key",
  legacyProjectId = null,
  markFails = false,
}: {
  name?: string;
  legacyProjectId?: string | null;
  markFails?: boolean;
} = {}) {
  let now: Instant = Temporal.Instant.from("2026-10-22T12:00:00Z");
  const stamps: string[] = [];
  const row = {
    id: "key-1",
    name,
    hashedSecret: "hashed",
    revokedAt: null,
    expiresAt: null,
    userId: "user-1",
    organizationId: "organization-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
  };
  const service = ApiKeyTokenResolutionService.create({
    authz: {
      listApiKeyBindings: async () => [
        {
          id: "grant-1",
          apiKeyId: "key-1",
          scopeType: "PROJECT",
          scopeId: "project-1",
          role: "VIEWER",
          customRoleId: null,
        },
      ],
    },
    repository: {
      findByLookupId: async () => row,
      upgradeHash: async () => undefined,
      findLivenessById: async () => ({ revokedAt: null, expiresAt: null }),
    },
    tokens: {
      findTokenParts: (token: string) =>
        token.startsWith("sk-lw-") && token !== LEGACY_TOKEN
          ? { lookupId: "lookup", secret: "secret" }
          : null,
      verify: () => "match",
      hash: () => "rehashed",
    },
    projects: {
      findIdentity: async () => project,
      findIdByLegacyApiKey: async () => legacyProjectId,
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

describe("the credential a request authenticated with", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  afterEach(() => {
    exporter.reset();
  });

  /** Runs `resolve` inside a request span and answers that span's attributes. */
  async function inRequestSpan(resolve: () => Promise<unknown>) {
    await trace.getTracer("test").startActiveSpan("request", async (span) => {
      await resolve();
      span.end();
    });

    return exporter.getFinishedSpans()[0]?.attributes ?? {};
  }

  /** @scenario "An API key request is recorded as an API key" */
  it("tags an API key with its kind and project, never the token", async () => {
    const { service } = serviceWith();

    const attributes = await inRequestSpan(() =>
      service.findResolvedToken({ token: CURRENT_TOKEN, projectId: "project-1" }),
    );

    expect(attributes[CREDENTIAL_TYPE_SPAN_ATTRIBUTE]).toBe("api_key");
    expect(attributes[CREDENTIAL_PROJECT_SPAN_ATTRIBUTE]).toBe("project-1");
    expect(JSON.stringify(attributes)).not.toContain(CURRENT_TOKEN);
  });

  /** @scenario "A CLI login token is recorded as a CLI token" */
  it("tags a key a CLI login minted as a CLI token", async () => {
    const { service } = serviceWith({ name: `${CLI_LOGIN_KEY_NAME_PREFIX}laptop` });

    const attributes = await inRequestSpan(() =>
      service.findResolvedToken({ token: CURRENT_TOKEN, projectId: "project-1" }),
    );

    expect(attributes[CREDENTIAL_TYPE_SPAN_ATTRIBUTE]).toBe("cli_token");
  });

  /** @scenario "A legacy project key is recorded as a legacy project key" */
  it("tags a legacy key with its kind and project", async () => {
    const { service } = serviceWith({ legacyProjectId: "project-1" });

    const attributes = await inRequestSpan(() =>
      service.findResolvedToken({ token: LEGACY_TOKEN }),
    );

    expect(attributes[CREDENTIAL_TYPE_SPAN_ATTRIBUTE]).toBe("legacy_project_key");
    expect(attributes[CREDENTIAL_PROJECT_SPAN_ATTRIBUTE]).toBe("project-1");
  });

  /** @scenario "A token that does not resolve records nothing" */
  it("records nothing for a token that matches no key", async () => {
    const { service, stamps } = serviceWith();

    const attributes = await inRequestSpan(() =>
      service.findResolvedToken({ token: UNKNOWN_TOKEN }),
    );

    expect(attributes[CREDENTIAL_TYPE_SPAN_ATTRIBUTE]).toBeUndefined();
    expect(stamps).toEqual([]);
  });

  /** @scenario "A legacy key's use stamps the project at most once a minute" */
  it("stamps a legacy key's project once a minute, and again after", async () => {
    const { service, stamps, advance } = serviceWith({ legacyProjectId: "project-1" });

    await service.findResolvedToken({ token: LEGACY_TOKEN });
    await service.findResolvedToken({ token: LEGACY_TOKEN });
    expect(stamps).toEqual(["project-1"]);

    advance(API_KEY_LAST_USED_WINDOW_MS + 1);
    await service.findResolvedToken({ token: LEGACY_TOKEN });
    expect(stamps).toEqual(["project-1", "project-1"]);
  });

  /** @scenario "A failed stamp does not fail the request" */
  it("still resolves the project when the stamp fails", async () => {
    const { service } = serviceWith({ legacyProjectId: "project-1", markFails: true });

    await expect(service.findResolvedToken({ token: LEGACY_TOKEN })).resolves.toMatchObject({
      type: "legacyProjectKey",
      project: { id: "project-1" },
    });
  });
});
