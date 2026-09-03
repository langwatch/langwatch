import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { PrismaMcpProjectLookupAdapter, tryCreateHostedMcpSurface } from "../hosted-mcp.mount";

const cipher = {
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value,
} as unknown as SecretEncryptionPort;

const prisma = { project: { findUnique: vi.fn() } } as unknown as PrismaClient;

describe("given the hosted MCP endpoint being composed for the API process", () => {
  describe("when the process has no stored-secret cipher", () => {
    it("serves no MCP rather than an endpoint whose sessions all fail", () => {
      expect(
        tryCreateHostedMcpSurface({
          prisma,
          encryption: undefined,
          redis: null,
          baseHost: "https://app.langwatch.ai",
        }),
      ).toBeUndefined();
    });
  });

  describe("when the process has no database", () => {
    it("serves no MCP, because no bearer token could be resolved to a project", () => {
      expect(
        tryCreateHostedMcpSurface({
          prisma: undefined,
          encryption: cipher,
          redis: null,
          baseHost: "https://app.langwatch.ai",
        }),
      ).toBeUndefined();
    });
  });

  describe("when both are composed", () => {
    it("claims the MCP routes and nothing else", () => {
      const surface = tryCreateHostedMcpSurface({
        prisma,
        encryption: cipher,
        redis: null,
        baseHost: "https://app.langwatch.ai",
      });

      expect(surface?.handles("/mcp")).toBe(true);
      expect(surface?.handles("/sse")).toBe(true);
      expect(surface?.handles("/.well-known/oauth-authorization-server")).toBe(true);
      expect(surface?.handles("/api/trace/search")).toBe(false);
      expect(surface?.handles("/healthz")).toBe(false);
    });
  });
});

describe("given a bearer token being resolved to its project", () => {
  describe("when the project it names was archived", () => {
    it("asks for a live project rather than filtering afterwards", async () => {
      const findUnique = vi.fn(() => Promise.resolve(null));
      const lookup = PrismaMcpProjectLookupAdapter.create({
        prisma: { project: { findUnique } } as unknown as PrismaClient,
      });

      await lookup.findLiveProjectByApiKey({ apiKey: "lw_key" });

      expect(findUnique).toHaveBeenCalledExactlyOnceWith({
        where: { apiKey: "lw_key", archivedAt: null },
        select: { id: true, teamId: true },
      });
    });
  });
});
