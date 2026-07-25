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
  SCENARIO_TAB_TTL_SECONDS,
  scenarioTabRegistry,
} from "../scenario-tab-registry";

const projectId = `proj-${nanoid(8)}`;
const otherProjectId = `proj-${nanoid(8)}`;

function keyFor(project: string, tabKey: string): string {
  return `scenario_tab:v1:${project}:${tabKey}`;
}

const writtenKeys: string[] = [];

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
  if (connection && writtenKeys.length > 0) {
    await connection.del(...writtenKeys);
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

  it("drops the tab as soon as it unregisters", async () => {
    const tabKey = `tab-${nanoid(8)}`;
    track(projectId, tabKey);

    await scenarioTabRegistry.register({ projectId, tabKey, tabId: "tab-a" });
    await scenarioTabRegistry.unregister({ projectId, tabKey, tabId: "tab-a" });

    await expect(
      scenarioTabRegistry.hasLiveTab({ projectId, tabKey }),
    ).resolves.toBe(false);
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
});
