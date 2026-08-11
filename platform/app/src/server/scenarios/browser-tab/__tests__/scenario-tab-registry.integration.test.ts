/**
 * @vitest-environment node
 * @integration
 *
 * Scenario tab presence, against real Redis.
 *
 * Covers specs/scenarios/scenario-tab-handoff.feature — the presence half. No
 * fakes: the registry writes to the same Redis the app uses, so TTLs, sorted
 * set semantics and key scoping are the real ones.
 */

import {
  createRedisConnection,
  type RedisConnection,
} from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  SCENARIO_TAB_DISCONNECT_GRACE_SECONDS,
  SCENARIO_TAB_PENDING_TTL_SECONDS,
  SCENARIO_TAB_TTL_SECONDS,
  scenarioTabPendingKey,
  scenarioTabRegistry,
} from "../scenario-tab-registry";

const projectId = `proj-${nanoid(8)}`;
const otherProjectId = `proj-${nanoid(8)}`;

function keyFor(project: string, tabKey: string): string {
  return `scenario_tab:v1:${project}:${tabKey}`;
}

const writtenKeys: string[] = [];
const pendingKeys: string[] = [];

function track(project: string, tabKey: string): string {
  const key = keyFor(project, tabKey);
  writtenKeys.push(key);
  return key;
}

/** The registry reads its connection off the App, so the test hands it one. */
let connection: RedisConnection | null = null;

beforeAll(async () => {
  connection = createRedisConnection({
    env: {
      url: process.env.REDIS_URL,
      clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
      dbIndex: process.env.REDIS_DB_INDEX,
    },
  });
  if (!connection) {
    throw new Error(
      "These tests need a real Redis; run them through the integration suite",
    );
  }
  await resetApp();
  globalForApp.__langwatch_app = createTestApp({ redis: connection });
});

afterAll(async () => {
  const keys = [...writtenKeys, ...pendingKeys];
  if (connection) {
    // Per-key DEL: a multi-key DEL spanning different hash slots is rejected
    // with CROSSSLOT when this runs against a cluster, which would throw out
    // of `afterAll` and leave every test key behind.
    for (const key of keys) {
      await connection.del(key);
    }
  }
  await resetApp();
  connection?.disconnect();
});

describe("scenarioTabRegistry", () => {
  it("keeps the disconnect grace inside the presence TTL", () => {
    // `unregister` retires a tab by ageing its score by the difference between
    // these two, so a grace at or above the TTL would extend a tab's life
    // instead of ending it, and a closed tab would keep taking runs.
    expect(SCENARIO_TAB_DISCONNECT_GRACE_SECONDS).toBeLessThan(
      SCENARIO_TAB_TTL_SECONDS,
    );
  });

  it("reports no live tab before anything registers", async () => {
    const tabKey = `tab-${nanoid(8)}`;
    track(projectId, tabKey);

    await expect(
      scenarioTabRegistry.hasLiveTab({ projectId, tabKey }),
    ).resolves.toBe(false);
  });

  it("reports a live tab once one registers", async () => {
    const tabKey = `tab-${nanoid(8)}`;
    track(projectId, tabKey);

    await scenarioTabRegistry.register({ projectId, tabKey, tabId: "tab-a" });

    await expect(
      scenarioTabRegistry.hasLiveTab({ projectId, tabKey }),
    ).resolves.toBe(true);
  });

  it("gives the registration a TTL so a dead browser expires on its own", async () => {
    const tabKey = `tab-${nanoid(8)}`;
    const key = track(projectId, tabKey);

    await scenarioTabRegistry.register({ projectId, tabKey, tabId: "tab-a" });

    const ttl = await connection!.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SCENARIO_TAB_TTL_SECONDS);
  });

  /** @scenario "Presence is refreshed while the subscription stays open" */
  it("re-registering pushes the TTL back out", async () => {
    const tabKey = `tab-${nanoid(8)}`;
    const key = track(projectId, tabKey);

    await scenarioTabRegistry.register({ projectId, tabKey, tabId: "tab-a" });
    await connection!.expire(key, 2);
    expect(await connection!.ttl(key)).toBeLessThanOrEqual(2);

    await scenarioTabRegistry.register({ projectId, tabKey, tabId: "tab-a" });

    expect(await connection!.ttl(key)).toBeGreaterThan(2);
  });

  describe("when a subscription ends", () => {
    /**
     * A tab drops its subscription every time it routes to another run — which
     * this feature does to it on purpose. Retiring instantly would make the run
     * right after a followed run open a new tab.
     */
    /** @scenario "A tab that is only reconnecting keeps its place" */
    it("keeps the tab claimable for the grace window", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      track(projectId, tabKey);
      const now = Date.now();

      await scenarioTabRegistry.register({
        projectId,
        tabKey,
        tabId: "tab-a",
        now,
      });
      await scenarioTabRegistry.unregister({
        projectId,
        tabKey,
        tabId: "tab-a",
        now,
      });

      await expect(
        scenarioTabRegistry.hasLiveTab({ projectId, tabKey, now: now + 1000 }),
      ).resolves.toBe(true);
    });

    /** @scenario "A tab that really went away stops taking runs" */
    it("stops claiming runs once the grace window passes", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      track(projectId, tabKey);
      const now = Date.now();

      await scenarioTabRegistry.register({
        projectId,
        tabKey,
        tabId: "tab-a",
        now,
      });
      await scenarioTabRegistry.unregister({
        projectId,
        tabKey,
        tabId: "tab-a",
        now,
      });

      await expect(
        scenarioTabRegistry.hasLiveTab({
          projectId,
          tabKey,
          now: now + (SCENARIO_TAB_DISCONNECT_GRACE_SECONDS + 1) * 1000,
        }),
      ).resolves.toBe(false);
    });

    it("restores the tab outright when it reconnects inside the window", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      track(projectId, tabKey);
      const now = Date.now();

      await scenarioTabRegistry.register({
        projectId,
        tabKey,
        tabId: "tab-a",
        now,
      });
      await scenarioTabRegistry.unregister({
        projectId,
        tabKey,
        tabId: "tab-a",
        now,
      });
      await scenarioTabRegistry.register({
        projectId,
        tabKey,
        tabId: "tab-a",
        now: now + 2000,
      });

      await expect(
        scenarioTabRegistry.hasLiveTab({
          projectId,
          tabKey,
          now: now + (SCENARIO_TAB_DISCONNECT_GRACE_SECONDS + 2) * 1000,
        }),
      ).resolves.toBe(true);
    });

    it("does not register a tab that was never there", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      track(projectId, tabKey);
      const now = Date.now();

      await scenarioTabRegistry.unregister({
        projectId,
        tabKey,
        tabId: "never-seen",
        now,
      });

      await expect(
        scenarioTabRegistry.hasLiveTab({ projectId, tabKey, now }),
      ).resolves.toBe(false);
    });

    it("does not revive a tab that had already aged out", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      track(projectId, tabKey);
      const now = Date.now();
      const wellPastTtl = now + (SCENARIO_TAB_TTL_SECONDS + 60) * 1000;

      await scenarioTabRegistry.register({
        projectId,
        tabKey,
        tabId: "tab-a",
        now,
      });
      // The browser died long ago; the late goodbye must not push it back
      // inside the live window.
      await scenarioTabRegistry.unregister({
        projectId,
        tabKey,
        tabId: "tab-a",
        now: wellPastTtl,
      });

      await expect(
        scenarioTabRegistry.hasLiveTab({
          projectId,
          tabKey,
          now: wellPastTtl,
        }),
      ).resolves.toBe(false);
    });
  });

  it("keeps the machine reusable while a sibling tab is still open", async () => {
    const tabKey = `tab-${nanoid(8)}`;
    track(projectId, tabKey);

    await scenarioTabRegistry.register({ projectId, tabKey, tabId: "tab-a" });
    await scenarioTabRegistry.register({ projectId, tabKey, tabId: "tab-b" });

    await scenarioTabRegistry.unregister({ projectId, tabKey, tabId: "tab-a" });

    await expect(
      scenarioTabRegistry.hasLiveTab({ projectId, tabKey }),
    ).resolves.toBe(true);
  });

  it("ages out a tab that stopped refreshing without saying goodbye", async () => {
    const tabKey = `tab-${nanoid(8)}`;
    track(projectId, tabKey);

    // A browser that crashed: the entry is there, but its last heartbeat is
    // older than the TTL. `now` is injected rather than slept through.
    const registeredAt = Date.now();
    await scenarioTabRegistry.register({
      projectId,
      tabKey,
      tabId: "tab-a",
      now: registeredAt,
    });

    await expect(
      scenarioTabRegistry.hasLiveTab({
        projectId,
        tabKey,
        now: registeredAt + (SCENARIO_TAB_TTL_SECONDS + 5) * 1000,
      }),
    ).resolves.toBe(false);
  });

  it("never leaks a registration across projects", async () => {
    const tabKey = `tab-${nanoid(8)}`;
    track(projectId, tabKey);
    track(otherProjectId, tabKey);

    await scenarioTabRegistry.register({ projectId, tabKey, tabId: "tab-a" });

    await expect(
      scenarioTabRegistry.hasLiveTab({ projectId: otherProjectId, tabKey }),
    ).resolves.toBe(false);
  });

  it("never leaks a registration across machines", async () => {
    const mine = `tab-${nanoid(8)}`;
    const theirs = `tab-${nanoid(8)}`;
    track(projectId, mine);
    track(projectId, theirs);

    await scenarioTabRegistry.register({
      projectId,
      tabKey: mine,
      tabId: "tab-a",
    });

    await expect(
      scenarioTabRegistry.hasLiveTab({ projectId, tabKey: theirs }),
    ).resolves.toBe(false);
  });

  describe("parked handoffs", () => {
    /**
     * Broadcasts are fire-and-forget: a tab that is mid-reload when one goes
     * out would miss a run the SDK was already told had been delivered.
     */
    /** @scenario "A handoff sent while the tab was reloading is not lost" */
    it("hands a parked run to the next subscription", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      pendingKeys.push(scenarioTabPendingKey(projectId, tabKey));

      await scenarioTabRegistry.setPendingNavigate({
        projectId,
        tabKey,
        url: "https://app.langwatch.test/p/simulations/s/batch-1",
      });

      await expect(
        scenarioTabRegistry.takePendingNavigate({ projectId, tabKey }),
      ).resolves.toBe("https://app.langwatch.test/p/simulations/s/batch-1");
    });

    it("hands it over only once", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      pendingKeys.push(scenarioTabPendingKey(projectId, tabKey));

      await scenarioTabRegistry.setPendingNavigate({
        projectId,
        tabKey,
        url: "https://app.langwatch.test/p/simulations/s/batch-1",
      });
      await scenarioTabRegistry.takePendingNavigate({ projectId, tabKey });

      await expect(
        scenarioTabRegistry.takePendingNavigate({ projectId, tabKey }),
      ).resolves.toBeNull();
    });

    it("expires a parked run so a tab opening much later does not jump to it", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      const key = scenarioTabPendingKey(projectId, tabKey);
      pendingKeys.push(key);

      await scenarioTabRegistry.setPendingNavigate({
        projectId,
        tabKey,
        url: "https://app.langwatch.test/p/simulations/s/batch-1",
      });

      // Redis holds the expiry, so the guarantee is the TTL it was given.
      const ttl = await connection!.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(SCENARIO_TAB_PENDING_TTL_SECONDS);

      await connection!.del(key);
      await expect(
        scenarioTabRegistry.takePendingNavigate({ projectId, tabKey }),
      ).resolves.toBeNull();
    });

    it("keeps parked handoffs apart per machine", async () => {
      const mine = `tab-${nanoid(8)}`;
      const theirs = `tab-${nanoid(8)}`;
      pendingKeys.push(scenarioTabPendingKey(projectId, mine));

      await scenarioTabRegistry.setPendingNavigate({
        projectId,
        tabKey: mine,
        url: "https://app.langwatch.test/p/simulations/s/batch-1",
      });

      await expect(
        scenarioTabRegistry.takePendingNavigate({ projectId, tabKey: theirs }),
      ).resolves.toBeNull();
    });
  });
});
