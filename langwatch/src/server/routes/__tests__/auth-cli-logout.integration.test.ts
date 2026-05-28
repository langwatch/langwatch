/**
 * @vitest-environment node
 *
 * Integration coverage for POST /api/auth/cli/logout — CLI-side
 * revocation that complements `langwatch logout`'s local config wipe.
 * Hits real Redis (testcontainers), no mocks.
 *
 * Cases:
 *   1. With refresh + access tokens → both deleted from Redis.
 *   2. With only refresh token → refresh deleted, access (if any) untouched.
 *   3. With only access token → access deleted, refresh (if any) untouched.
 *   4. With neither token → 200 (idempotent no-op).
 *   5. With unknown tokens → 200 (idempotent, just nothing to delete).
 *
 * Spec: specs/ai-gateway/governance/cli-login.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connection as redisConnection } from "~/server/redis";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { app } from "../auth-cli";

const suffix = nanoid(8);

async function callLogout(body: Record<string, unknown>) {
  return await app.request("/api/auth/cli/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function plant(prefix: string, token: string) {
  if (!redisConnection) throw new Error("Redis required");
  await redisConnection.set(
    `${prefix}${token}`,
    JSON.stringify({ user_id: "u", organization_id: "o" }),
    "EX",
    3600,
  );
}
async function exists(prefix: string, token: string): Promise<boolean> {
  if (!redisConnection) throw new Error("Redis required");
  return (await redisConnection.exists(`${prefix}${token}`)) === 1;
}

describe("POST /api/auth/cli/logout", () => {
  beforeAll(async () => {
    await startTestContainers();
  }, 60_000);

  afterAll(async () => {
    await stopTestContainers();
  }, 60_000);

  describe("when both refresh + access tokens are supplied", () => {
    it("deletes both — full revocation, no surviving credentials", async () => {
      const refresh = `lw_rt_${suffix}-both-r`;
      const access = `lw_at_${suffix}-both-a`;
      await plant("lwcli:refresh:", refresh);
      await plant("lwcli:access:", access);

      const res = await callLogout({
        refresh_token: refresh,
        access_token: access,
      });

      expect(res.status).toBe(200);
      expect(await exists("lwcli:refresh:", refresh)).toBe(false);
      expect(await exists("lwcli:access:", access)).toBe(false);
    });
  });

  describe("when only the refresh token is supplied", () => {
    it("deletes the refresh and leaves any access token in place", async () => {
      const refresh = `lw_rt_${suffix}-r-only-r`;
      const access = `lw_at_${suffix}-r-only-a`;
      await plant("lwcli:refresh:", refresh);
      await plant("lwcli:access:", access);

      const res = await callLogout({ refresh_token: refresh });

      expect(res.status).toBe(200);
      expect(await exists("lwcli:refresh:", refresh)).toBe(false);
      expect(await exists("lwcli:access:", access)).toBe(true);
    });
  });

  describe("when only the access token is supplied", () => {
    it("deletes the access and leaves any refresh token in place", async () => {
      const refresh = `lw_rt_${suffix}-a-only-r`;
      const access = `lw_at_${suffix}-a-only-a`;
      await plant("lwcli:refresh:", refresh);
      await plant("lwcli:access:", access);

      const res = await callLogout({ access_token: access });

      expect(res.status).toBe(200);
      expect(await exists("lwcli:refresh:", refresh)).toBe(true);
      expect(await exists("lwcli:access:", access)).toBe(false);
    });
  });

  describe("when neither token is supplied", () => {
    it("returns 200 idempotent — nothing to revoke", async () => {
      const res = await callLogout({});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  describe("when supplied tokens don't exist in Redis", () => {
    it("returns 200 idempotent — unknown tokens are a safe no-op", async () => {
      const res = await callLogout({
        refresh_token: `lw_rt_${suffix}-unknown`,
        access_token: `lw_at_${suffix}-unknown`,
      });
      expect(res.status).toBe(200);
    });
  });
});
