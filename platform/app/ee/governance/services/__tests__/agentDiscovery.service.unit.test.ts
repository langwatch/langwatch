// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The seam that calls a provider outside the scheduled pull, and what it writes
 * down afterwards.
 *
 * Prisma is a fake and `ssrfSafeFetch` is a mock, so what is under test is the
 * decision sequence: which sources may be asked, what the credential seam hands
 * to the caller, and — the case this feature exists for — that a refusal
 * records nothing while an empty list records nothing for a different reason
 * the caller can see.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { IngestionSourceNotFoundError } from "../activity-monitor/ingestionSource.service";
import { AgentDiscoveryService } from "../agentDiscovery.service";
import { withSourceCredentials } from "../pullers/sourceCredentialAccess";

vi.mock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: vi.fn() }));
const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
const fetchMock = vi.mocked(ssrfSafeFetch);

const organizationId = "org_agent_sync";
const ingestionSourceId = "src_genie_1";
const now = new Date("2026-09-09T00:00:00.000Z");

const reply = (params: { ok: boolean; status: number; body?: unknown }) =>
  ({
    ok: params.ok,
    status: params.status,
    statusText: "",
    json: async () => params.body ?? {},
  }) as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>;

const genieSource = {
  id: ingestionSourceId,
  sourceType: "databricks_genie",
  parserConfig: {
    adapter: "databricks_genie",
    workspaceUrl: "https://adb-1.azuredatabricks.net",
    spaceIds: [],
    schedule: "*/15 * * * *",
    // A legacy plaintext subtree rather than a sealed envelope, which
    // `decryptCredentials` accepts by design: this file asserts the seam's
    // plumbing, not the cipher, and sealing here would make every case in it
    // depend on an encryption key being present.
    credentials: { token: "workspace-token" },
  },
};

/** Records every `discoveredAgent` write and reports the source on demand. */
const fakePrisma = (source: unknown) => {
  const sightings: Record<string, unknown>[] = [];
  const prisma = {
    ingestionSource: { findFirst: async () => source },
    discoveredAgent: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        sightings.push(data[0]!);
        return { count: 1 };
      },
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;
  return { prisma, sightings };
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("AgentDiscoveryService.syncFromSource", () => {
  describe("given the workspace lists spaces", () => {
    it("records one agent per space with the provider on the row", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({
          ok: true,
          status: 200,
          body: {
            spaces: [
              { space_id: "s1", title: "Revenue Analyst" },
              { space_id: "s2", title: null },
            ],
          },
        }),
      );
      const { prisma, sightings } = fakePrisma(genieSource);

      const result = await AgentDiscoveryService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({ outcome: "listed", recorded: 2 });
      expect(sightings).toEqual([
        {
          organizationId,
          provider: "databricks_genie",
          rawAgentId: "s1",
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
          firstSeenAt: now,
          lastSeenAt: now,
        },
        {
          organizationId,
          provider: "databricks_genie",
          rawAgentId: "s2",
          displayText: "s2",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
          firstSeenAt: now,
          lastSeenAt: now,
        },
      ]);
    });
  });

  describe("given the workspace refuses to enumerate", () => {
    it("reports the refusal and writes no rows", async () => {
      fetchMock.mockResolvedValueOnce(reply({ ok: false, status: 403 }));
      const { prisma, sightings } = fakePrisma(genieSource);

      const result = await AgentDiscoveryService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({
        outcome: "refused",
        refusal: { reason: "unauthorized", status: 403 },
      });
      // A refusal is not evidence an agent stopped existing, so the rows
      // already recorded are left exactly as they were.
      expect(sightings).toEqual([]);
    });
  });

  describe("given the workspace lists no spaces at all", () => {
    it("reports empty, which a caller can tell from a refusal", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({ ok: true, status: 200, body: { spaces: [] } }),
      );
      const { prisma, sightings } = fakePrisma(genieSource);

      const result = await AgentDiscoveryService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({ outcome: "empty" });
      expect(sightings).toEqual([]);
    });
  });

  describe("given the source holds no credential the provider accepts", () => {
    it("reports not_configured without calling the provider", async () => {
      const { prisma, sightings } = fakePrisma({
        ...genieSource,
        parserConfig: { ...genieSource.parserConfig, credentials: {} },
      });

      const result = await AgentDiscoveryService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sightings).toEqual([]);
    });
  });

  describe("given a source type with no agent list", () => {
    it("refuses rather than failing, so one source cannot break a sweep", async () => {
      const { prisma } = fakePrisma({
        id: "src_s3",
        sourceType: "s3_polling",
        parserConfig: {},
      });

      const result = await AgentDiscoveryService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId: "src_s3",
        now,
      });

      expect(result).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("given the sign-in itself is refused", () => {
    it("reports unauthorized rather than a network problem", async () => {
      // No pasted token, so the adapter signs in with the service principal
      // and the token endpoint is the thing that answers 401.
      fetchMock.mockResolvedValueOnce(reply({ ok: false, status: 401 }));
      const { prisma } = fakePrisma({
        ...genieSource,
        parserConfig: {
          ...genieSource.parserConfig,
          credentials: { clientId: "id", clientSecret: "secret" },
        },
      });

      const result = await AgentDiscoveryService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({
        outcome: "refused",
        refusal: { reason: "unauthorized", status: 401 },
      });
    });
  });
});

describe("withSourceCredentials", () => {
  describe("given a source in another organization", () => {
    it("refuses by the name a customer can act on", async () => {
      const { prisma } = fakePrisma(null);

      await expect(
        withSourceCredentials({
          prisma,
          organizationId: "org_someone_else",
          ingestionSourceId,
          use: async () => "should not run",
        }),
      ).rejects.toBeInstanceOf(IngestionSourceNotFoundError);
    });
  });

  describe("given the caller is handed the source config", () => {
    it("strips the credentials envelope out of it", async () => {
      const { prisma } = fakePrisma(genieSource);

      const context = await withSourceCredentials({
        prisma,
        organizationId,
        ingestionSourceId,
        use: async (ctx) => ctx,
      });

      // The config a caller could spread into a response carries no secret,
      // sealed or otherwise; the plaintext travels on its own field.
      expect(context.config).not.toHaveProperty("credentials");
      expect(context.config).toMatchObject({
        workspaceUrl: "https://adb-1.azuredatabricks.net",
      });
      expect(context.credentials).toEqual({ token: "workspace-token" });
      expect(context.sourceType).toBe("databricks_genie");
    });
  });
});
