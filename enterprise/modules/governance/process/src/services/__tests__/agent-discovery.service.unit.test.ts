// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  GovernanceEncryptor,
  GovernanceHttpClient,
  GovernanceHttpResponse,
} from "../../app/governance.members.ts";
import { HttpCopilotBotsChannel } from "../../channels/http/http.copilot-bots.channel.ts";
import { HttpGenieSpacesChannel } from "../../channels/http/http.genie-spaces.channel.ts";
import { HttpProviderSignInChannel } from "../../channels/http/http.provider-sign-in.channel.ts";
import { MemoryDiscoveredAgentRepository } from "../../repositories/memory/memory.discovered-agent.repository.ts";
import { MemoryDiscoveredPeopleStore } from "../../repositories/memory/memory.discovered-people.store.ts";
import { MemoryIngestionSourceRepository } from "../../repositories/memory/memory.ingestion-source.repository.ts";
import { AgentDiscoveryService } from "../agent-discovery.service.ts";
import { IngestionCredentialsService } from "../ingestion-credentials.service.ts";
import { SourceCredentialAccessService } from "../source-credential-access.service.ts";

const ORG = "org_agent_sync";
const NOW = Temporal.Instant.from("2026-09-09T00:00:00.000Z");
const WORKSPACE = "https://adb-1.azuredatabricks.net";

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
  sourceType = "databricks_genie",
  parserConfig = {
    adapter: "databricks_genie",
    workspaceUrl: WORKSPACE,
    spaceIds: [],
    schedule: "*/15 * * * *",
    credentials: { token: "workspace-token" },
  },
}: {
  script?: Scripted[];
  sourceType?: SourceType;
  parserConfig?: Record<string, unknown>;
} = {}) {
  const http = new ScriptedHttp(script);
  const store = MemoryDiscoveredPeopleStore.create();
  const sources = MemoryIngestionSourceRepository.create();
  const credentials = IngestionCredentialsService.create(new ReversibleEncryption());
  const source = await sources.create({
    organizationId: ORG,
    teamId: null,
    traceProjectId: null,
    sourceType,
    name: "Genie",
    description: null,
    ingestSecretHash: "hash",
    parserConfig: credentials.encryptParserConfig(parserConfig),
    pullSchedule: null,
    status: "awaiting_first_event",
    createdById: "user_1",
    providerAccountId: null,
  });
  const service = AgentDiscoveryService.create({
    agents: MemoryDiscoveredAgentRepository.create(store),
    sourceCredentials: SourceCredentialAccessService.create({ sources, credentials }),
    signIn: HttpProviderSignInChannel.create({ http }),
    genieSpaces: HttpGenieSpacesChannel.create({ http }),
    copilotBots: HttpCopilotBotsChannel.create({ http }),
    logger: createTestLogger().logger,
  });
  const sync = () =>
    service.syncFromSource({ organizationId: ORG, ingestionSourceId: source.id, now: NOW });
  return { http, store, sync };
}

const servicePrincipal = {
  adapter: "databricks_genie",
  workspaceUrl: WORKSPACE,
  spaceIds: [],
  schedule: "*/15 * * * *",
  credentials: { clientId: "id", clientSecret: "secret" },
};

describe("AgentDiscoveryService.syncFromSource", () => {
  describe("given the workspace lists spaces", () => {
    it("records one agent per space with the provider on the row", async () => {
      const { store, sync } = await buildWorld({
        script: [
          {
            ok: true,
            status: 200,
            body: {
              spaces: [
                { space_id: "s1", title: "Revenue Analyst" },
                { space_id: "s2", title: null },
              ],
            },
          },
        ],
      });

      expect(await sync()).toEqual({ outcome: "listed", recorded: 2 });
      expect(
        store.agents.map(({ provider, rawAgentId, displayText, metadata, firstSeenAt }) => ({
          provider,
          rawAgentId,
          displayText,
          metadata,
          firstSeenAt,
        })),
      ).toEqual([
        {
          provider: "databricks_genie",
          rawAgentId: "s1",
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
          firstSeenAt: NOW,
        },
        {
          provider: "databricks_genie",
          rawAgentId: "s2",
          displayText: "s2",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
          firstSeenAt: NOW,
        },
      ]);
    });
  });

  describe("given the workspace refuses to enumerate", () => {
    it("reports the refusal and writes no rows", async () => {
      const { store, sync } = await buildWorld({ script: [{ ok: false, status: 403 }] });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "unauthorized", status: 403 },
      });
      expect(store.agents).toEqual([]);
    });
  });

  describe("given the workspace lists no spaces at all", () => {
    it("reports empty, which a caller can tell from a refusal", async () => {
      const { store, sync } = await buildWorld({
        script: [{ ok: true, status: 200, body: { spaces: [] } }],
      });

      expect(await sync()).toEqual({ outcome: "empty" });
      expect(store.agents).toEqual([]);
    });
  });

  describe("given the source holds no credential the provider accepts", () => {
    it("reports not_configured without calling the provider", async () => {
      const { http, store, sync } = await buildWorld({
        parserConfig: { ...servicePrincipal, credentials: {} },
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(http.calls).toEqual([]);
      expect(store.agents).toEqual([]);
    });
  });

  describe("given a source type with no agent list", () => {
    it("refuses rather than failing, so one source cannot break a sweep", async () => {
      const { http, sync } = await buildWorld({ sourceType: "s3_custom", parserConfig: {} });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(http.calls).toEqual([]);
    });
  });

  describe("given the sign-in itself is refused", () => {
    it("reports unauthorized rather than a network problem", async () => {
      const { sync } = await buildWorld({
        script: [{ ok: false, status: 401 }],
        parserConfig: servicePrincipal,
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "unauthorized", status: 401 },
      });
    });
  });

  describe("given the network drops while signing in", () => {
    /** @scenario "A refusal that was only unreachable says to ask again" */
    it("reports unreachable rather than an unconfigured source", async () => {
      const { store, sync } = await buildWorld({
        script: [{ throws: new TypeError("fetch failed") }],
        parserConfig: servicePrincipal,
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "unreachable", status: null },
      });
      expect(store.agents).toEqual([]);
    });
  });

  describe("given the sign-in times out", () => {
    /** @scenario "A refusal that was only unreachable says to ask again" */
    it("reports unreachable, because an abort is not a permission problem", async () => {
      const { sync } = await buildWorld({
        script: [{ throws: new DOMException("The operation timed out.", "TimeoutError") }],
        parserConfig: servicePrincipal,
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "unreachable", status: null },
      });
    });
  });

  describe("given the stored config no longer matches its schema", () => {
    it("still reports not_configured, which is the one case that verdict was written for", async () => {
      const { http, sync } = await buildWorld({
        parserConfig: { ...servicePrincipal, workspaceUrl: undefined },
      });

      expect(await sync()).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(http.calls).toEqual([]);
    });
  });
});
