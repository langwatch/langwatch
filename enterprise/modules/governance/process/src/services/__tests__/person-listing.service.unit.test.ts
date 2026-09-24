// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  GovernanceEncryptor,
  GovernanceHttpClient,
  GovernanceHttpResponse,
} from "../../app/governance.members.ts";
import { HttpAdminApiUsersChannel } from "../../channels/http/http.admin-api-users.channel.ts";
import { HttpDatabricksScimUsersChannel } from "../../channels/http/http.databricks-scim-users.channel.ts";
import { HttpMicrosoftDirectoryChannel } from "../../channels/http/http.microsoft-directory.channel.ts";
import { HttpProviderSignInChannel } from "../../channels/http/http.provider-sign-in.channel.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { MemoryIngestionSourceRepository } from "../../repositories/memory/memory.ingestion-source.repository.ts";
import { erasureDigest } from "../../rules/erasure-digest.rules.ts";
import { ErasureSuppressionService } from "../erasure-suppression.service.ts";
import { IngestionCredentialsService } from "../ingestion-credentials.service.ts";
import { PersonDiscoveryService } from "../person-discovery.service.ts";
import { PersonListingService } from "../person-listing.service.ts";
import { SourceCredentialAccessService } from "../source-credential-access.service.ts";

const ORG = "org_people_sync";
const NOW = Temporal.Instant.from("2026-09-09T12:00:00.000Z");
const ERASURE_SECRET = "a".repeat(64);

const OPENAI_CONFIG = {
  adapter: "openai_admin",
  report: "cost",
  schedule: "0 * * * *",
  credentials: { token: "sk-admin" },
};

const GENIE_SIGN_IN_CONFIG = {
  adapter: "databricks_genie",
  workspaceUrl: "https://example.cloud.databricks.com",
  credentials: { clientId: "id", clientSecret: "secret" },
};

class ReversibleEncryption implements GovernanceEncryptor {
  encrypt(value: string): string {
    return Buffer.from(value).toString("base64url");
  }
  decrypt(value: string): string {
    return Buffer.from(value, "base64url").toString();
  }
}

type SourceType = Parameters<MemoryIngestionSourceRepository["create"]>[0]["sourceType"];

type Scripted = { ok: boolean; status: number; body?: unknown } | { throws: unknown };

/** The transport itself answers or throws, so the classification under test is the real one. */
class ScriptedHttp implements GovernanceHttpClient {
  readonly calls: string[] = [];

  constructor(private readonly script: Scripted[]) {}

  async fetch(url: string): Promise<GovernanceHttpResponse> {
    this.calls.push(url);
    const next = this.script.shift();
    if (!next) throw new Error(`unscripted call to ${url}`);
    if ("throws" in next) throw next.throws;
    return {
      ok: next.ok,
      status: next.status,
      statusText: "",
      json: async () => next.body ?? {},
      text: async () => JSON.stringify(next.body ?? {}),
    };
  }
}

async function buildWorld({
  script = [],
  sourceType = "openai_admin",
  parserConfig = OPENAI_CONFIG,
  suppressed = [],
}: {
  script?: Scripted[];
  sourceType?: SourceType;
  parserConfig?: Record<string, unknown>;
  suppressed?: string[];
} = {}) {
  const http = new ScriptedHttp(script);
  const repositories = MemoryGovernanceRepositories.create();
  const sources = MemoryIngestionSourceRepository.create();
  const credentials = IngestionCredentialsService.create(new ReversibleEncryption());
  const source = await sources.create({
    organizationId: ORG,
    teamId: null,
    traceProjectId: null,
    sourceType,
    name: "Source",
    description: null,
    ingestSecretHash: "hash",
    parserConfig: credentials.encryptParserConfig(parserConfig),
    pullSchedule: null,
    status: "awaiting_first_event",
    createdById: "user_1",
    providerAccountId: null,
  });
  await repositories.erasedIdentifierSuppressions.recordAll({
    organizationId: ORG,
    provider: sourceType,
    identifierHashes: suppressed.map((identifier) =>
      erasureDigest({ secret: ERASURE_SECRET, identifier }),
    ),
    erasedAt: NOW,
  });
  const logger = createTestLogger().logger;
  const service = PersonListingService.create({
    sourceCredentials: SourceCredentialAccessService.create({ sources, credentials }),
    suppression: ErasureSuppressionService.create({
      suppressions: repositories.erasedIdentifierSuppressions,
      tenantHistory: repositories.tenantHistory,
      erasureSecret: ERASURE_SECRET,
      logger,
    }),
    discovery: PersonDiscoveryService.create({ people: repositories.discoveredPeople }),
    signIn: HttpProviderSignInChannel.create({ http }),
    adminApiUsers: HttpAdminApiUsersChannel.create({ http }),
    microsoftDirectory: HttpMicrosoftDirectoryChannel.create({ http }),
    databricksScimUsers: HttpDatabricksScimUsersChannel.create({ http }),
    logger,
  });
  const sync = ({ organizationId = ORG }: { organizationId?: string } = {}) =>
    service.syncFromSource({ organizationId, ingestionSourceId: source.id, now: NOW });
  const people = () => repositories.discoveredPeople.findByOrganization({ organizationId: ORG });
  return { http, sync, people };
}

describe("PersonListingService.syncFromSource", () => {
  describe("given the provider names people", () => {
    it("records one person per member, with the source type as provider", async () => {
      const { sync, people } = await buildWorld({
        script: [
          {
            ok: true,
            status: 200,
            body: {
              data: [
                { id: "user-1", name: "Ada", email: "ada@example.com" },
                { id: "user-2", name: "Grace", email: "grace@example.com" },
              ],
            },
          },
        ],
      });

      expect(await sync()).toEqual({ outcome: "listed", recorded: 2, named: 2, withheld: 0 });
      const rows = (await people()).toSorted((a, b) => a.rawActorId.localeCompare(b.rawActorId));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        organizationId: ORG,
        provider: "openai_admin",
        rawActorId: "user-1",
        displayText: "Ada",
      });
    });

    it("stamps them from the listing day rather than the instant", async () => {
      const { sync, people } = await buildWorld({
        script: [{ ok: true, status: 200, body: { data: [{ id: "user-1", name: "Ada" }] } }],
      });

      await sync();

      expect((await people())[0]).toMatchObject({
        firstSeenAt: Temporal.Instant.from("2026-09-09T00:00:00.000Z"),
        lastSeenAt: Temporal.Instant.from("2026-09-09T00:00:00.000Z"),
      });
    });
  });

  describe("given somebody the provider still lists has been erased", () => {
    it("writes no row for them", async () => {
      const { sync, people } = await buildWorld({
        script: [
          {
            ok: true,
            status: 200,
            body: {
              data: [
                { id: "user-erased", name: "Erased" },
                { id: "user-2", name: "Grace" },
              ],
            },
          },
        ],
        suppressed: ["user-erased"],
      });

      const result = await sync();

      expect((await people()).map((row) => row.rawActorId)).toEqual(["user-2"]);
      expect(result).toEqual({ outcome: "listed", recorded: 1, named: 2, withheld: 1 });
    });

    it("still reads as a listing when every listed person is erased", async () => {
      const { sync, people } = await buildWorld({
        script: [
          { ok: true, status: 200, body: { data: [{ id: "user-erased", name: "Erased" }] } },
        ],
        suppressed: ["user-erased"],
      });

      expect(await sync()).toEqual({ outcome: "listed", recorded: 0, named: 1, withheld: 1 });
      expect(await people()).toEqual([]);
    });
  });

  describe("given the provider refuses", () => {
    it("writes nothing and reports the reason and the status", async () => {
      const { sync, people } = await buildWorld({ script: [{ ok: false, status: 403 }] });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "unauthorized", status: 403 },
      });
      expect(await people()).toEqual([]);
    });
  });

  describe("given the provider names nobody", () => {
    it("writes nothing, and says so differently from a refusal", async () => {
      const { sync, people } = await buildWorld({
        script: [{ ok: true, status: 200, body: { data: [] } }],
      });

      expect(await sync()).toEqual({ outcome: "empty" });
      expect(await people()).toEqual([]);
    });
  });

  describe("given the source holds no credential", () => {
    it("refuses as not_configured without calling the provider", async () => {
      const { http, sync } = await buildWorld({
        parserConfig: { ...OPENAI_CONFIG, credentials: {} },
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(http.calls).toEqual([]);
    });
  });

  describe("given a source type with no people list", () => {
    it("refuses rather than failing, so one source in a list can say no", async () => {
      const { http, sync } = await buildWorld({
        sourceType: "s3_custom",
        parserConfig: { credentials: { token: "unused" } },
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(http.calls).toEqual([]);
    });
  });

  describe("given the provider cannot be reached", () => {
    it("says unreachable rather than blaming the credential", async () => {
      const { sync } = await buildWorld({
        script: [{ throws: new TypeError("fetch failed") }],
        sourceType: "databricks_genie",
        parserConfig: GENIE_SIGN_IN_CONFIG,
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "unreachable", status: null },
      });
    });

    it("says unreachable when the request times out", async () => {
      const { sync } = await buildWorld({
        script: [{ throws: new DOMException("The operation timed out.", "TimeoutError") }],
        sourceType: "databricks_genie",
        parserConfig: GENIE_SIGN_IN_CONFIG,
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "unreachable", status: null },
      });
    });
  });

  describe("given the source config no longer parses", () => {
    it("refuses as not_configured before any request goes out", async () => {
      const { http, sync } = await buildWorld({
        sourceType: "databricks_genie",
        parserConfig: { adapter: "databricks_genie", credentials: { token: "dapi-token" } },
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(http.calls).toEqual([]);
    });
  });

  describe("given the source belongs to another organization", () => {
    it("raises rather than decrypting its credentials", async () => {
      const { http, sync } = await buildWorld();

      await expect(sync({ organizationId: "org_other" })).rejects.toMatchObject({
        code: "ingestion_source_not_found",
      });
      expect(http.calls).toEqual([]);
    });
  });
});
