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

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connection } from "~/server/redis";
import {
  SCENARIO_TAB_DISCONNECT_GRACE_SECONDS,
  SCENARIO_TAB_PENDING_TTL_SECONDS,
  SCENARIO_TAB_TTL_SECONDS,
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

beforeAll(() => {
  if (!connection) {
    throw new Error(
      "These tests need a real Redis; run them through the integration suite",
    );
  }
});

afterAll(async () => {
  const keys = [...writtenKeys, ...pendingKeys];
  if (connection && keys.length > 0) {
    await connection.del(...keys);
  }
});

describe("scenarioTabRegistry", () => {
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

    it("never resurrects a tab that already aged out", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      track(projectId, tabKey);
      const now = Date.now();

      // Nothing was ever registered under this id.
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
    it("hands a parked run to the next subscription", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      pendingKeys.push(`scenario_tab:v1:pending:${projectId}:${tabKey}`);

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
      pendingKeys.push(`scenario_tab:v1:pending:${projectId}:${tabKey}`);

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

    it("gives a tab that opens much later nothing to jump to", async () => {
      const tabKey = `tab-${nanoid(8)}`;
      const key = `scenario_tab:v1:pending:${projectId}:${tabKey}`;
      pendingKeys.push(key);

      await scenarioTabRegistry.setPendingNavigate({
        projectId,
        tabKey,
        url: "https://app.langwatch.test/p/simulations/s/batch-1",
      });

      const ttl = await connection!.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(SCENARIO_TAB_PENDING_TTL_SECONDS);
    });

    it("keeps parked handoffs apart per machine", async () => {
      const mine = `tab-${nanoid(8)}`;
      const theirs = `tab-${nanoid(8)}`;
      pendingKeys.push(`scenario_tab:v1:pending:${projectId}:${mine}`);

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
