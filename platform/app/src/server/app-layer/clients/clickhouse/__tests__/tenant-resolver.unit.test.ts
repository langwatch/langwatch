import type { ClickHouseClient } from "@langwatch/clickhouse";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AppClickHouseClient } from "../../clickhouseClient.factory";
import { parsePrivateClickHouseUrls } from "../private-endpoints";
import {
  createClickHouseClientResolver,
  createOrganizationClickHouseClientResolver,
} from "../tenant-resolver";

function fakeAppClient(): AppClickHouseClient & {
  resolveClient: ReturnType<typeof vi.fn>;
} {
  const resolveClient = vi.fn(
    () => ({ query: vi.fn(), insert: vi.fn() }) as unknown as ClickHouseClient,
  );
  return {
    resolveClient,
    knownTargets: () => [],
    clientForTarget: resolveClient,
    close: vi.fn(),
  } as unknown as AppClickHouseClient & {
    resolveClient: ReturnType<typeof vi.fn>;
  };
}

function fakePrisma(findUnique: ReturnType<typeof vi.fn>): PrismaClient {
  return { project: { findUnique } } as unknown as PrismaClient;
}

describe("given parsePrivateClickHouseUrls()", () => {
  describe("when an env var names an organisation", () => {
    it("keys the url on the id after the last separator, ignoring the label", () => {
      const urls = parsePrivateClickHouseUrls({
        "CLICKHOUSE_URL__acme__org-123": "http://acme:8123/lw",
        CLICKHOUSE_URL: "http://shared:8123/lw",
      } as NodeJS.ProcessEnv);

      expect([...urls]).toEqual([["org-123", "http://acme:8123/lw"]]);
    });
  });

  describe("when two env vars name the same organisation", () => {
    it("throws rather than picking one of two endpoints for a tenant", () => {
      expect(() =>
        parsePrivateClickHouseUrls({
          "CLICKHOUSE_URL__acme__org-123": "http://a:8123/lw",
          "CLICKHOUSE_URL__acme_renamed__org-123": "http://b:8123/lw",
        } as NodeJS.ProcessEnv),
      ).toThrow(/Duplicate private ClickHouse config/);
    });
  });

  describe("when an env var has an empty value", () => {
    it("skips it rather than routing a tenant at nothing", () => {
      const urls = parsePrivateClickHouseUrls({
        "CLICKHOUSE_URL__acme__org-123": "   ",
      } as NodeJS.ProcessEnv);

      expect(urls.size).toBe(0);
    });
  });
});

describe("given a project ClickHouse resolver", () => {
  describe("when the project belongs to an organisation", () => {
    it("routes on the organisation but scopes the client to the project", async () => {
      const client = fakeAppClient();
      const findUnique = vi
        .fn()
        .mockResolvedValue({ team: { organizationId: "org-123" } });
      const resolve = createClickHouseClientResolver({
        client,
        prisma: fakePrisma(findUnique),
      });

      const tenant = await resolve("project-1");

      expect(client.resolveClient).toHaveBeenCalledWith("org-123");
      expect(tenant.tenantId).toBe("project-1");
    });

    it("looks the organisation up once and serves later calls from memory", async () => {
      const client = fakeAppClient();
      const findUnique = vi
        .fn()
        .mockResolvedValue({ team: { organizationId: "org-123" } });
      const resolve = createClickHouseClientResolver({
        client,
        prisma: fakePrisma(findUnique),
      });

      await resolve("project-1");
      await resolve("project-1");

      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the project does not exist", () => {
    it("throws rather than falling back to the shared endpoint", async () => {
      const client = fakeAppClient();
      const resolve = createClickHouseClientResolver({
        client,
        prisma: fakePrisma(vi.fn().mockResolvedValue(null)),
      });

      await expect(resolve("ghost")).rejects.toThrow(/Refusing to fall back/);
      expect(client.resolveClient).not.toHaveBeenCalled();
    });
  });
});

describe("given an organisation ClickHouse resolver", () => {
  describe("when a governance read resolves its tenant", () => {
    it("uses the organisation as both routing key and tenant, with no project lookup", async () => {
      const client = fakeAppClient();
      const resolve = createOrganizationClickHouseClientResolver(client);

      const tenant = await resolve("org-123");

      expect(client.resolveClient).toHaveBeenCalledWith("org-123");
      expect(tenant.tenantId).toBe("org-123");
    });
  });
});
