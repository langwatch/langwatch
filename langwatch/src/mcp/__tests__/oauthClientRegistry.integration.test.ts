/**
 * @vitest-environment node
 *
 * Repository-level coverage for the MCP OAuth client registry — the
 * client_id -> redirect_uris binding /mcp/authorize validates against
 * (RFC 6749 §10.6 / RFC 7591). Hits real Redis (testcontainers), no mocks:
 * per dev/docs/best_practices/repository-service.md, "avoid mocking
 * repositories — it tests implementation details. If the service works with
 * a real database, it works."
 *
 * Spec: specs/mcp-server/mcp-in-app.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { connection as redis } from "~/server/redis";

import { getOAuthClient, registerOAuthClient } from "../oauthClientRegistry";

describe("OAuth client registry", () => {
  beforeAll(async () => {
    await startTestContainers();
  }, 60_000);

  afterAll(async () => {
    await stopTestContainers();
  }, 60_000);

  describe("when a client is registered then looked up", () => {
    /** @scenario Dynamic client registration persists the redirect_uris binding */
    it("round-trips the exact redirect_uris and client_name", async () => {
      const clientId = `mcp_${nanoid(12)}`;
      await registerOAuthClient(clientId, {
        redirectUris: ["https://registered.example/callback"],
        clientName: "Round-trip client",
      });

      const found = await getOAuthClient(clientId);

      expect(found).toEqual({
        redirectUris: ["https://registered.example/callback"],
        clientName: "Round-trip client",
      });
    });
  });

  describe("when the client_id was never registered", () => {
    it("returns null", async () => {
      const found = await getOAuthClient(`mcp_${nanoid(12)}_never_registered`);
      expect(found).toBeNull();
    });
  });

  describe("when the stored registration is corrupted JSON", () => {
    it("returns null instead of throwing", async () => {
      const clientId = `mcp_${nanoid(12)}`;
      if (!redis) throw new Error("Redis required");
      await redis.set(`mcp:oauth:client:${clientId}`, "{not json", "EX", 60);

      const found = await getOAuthClient(clientId);

      expect(found).toBeNull();
    });
  });

  describe("when the stored registration has a non-array redirectUris", () => {
    it("returns null instead of trusting the malformed shape", async () => {
      const clientId = `mcp_${nanoid(12)}`;
      if (!redis) throw new Error("Redis required");
      await redis.set(
        `mcp:oauth:client:${clientId}`,
        JSON.stringify({ redirectUris: "not-an-array", clientName: "x" }),
        "EX",
        60,
      );

      const found = await getOAuthClient(clientId);

      expect(found).toBeNull();
    });
  });
});
