/**
 * Presence's settings fold against a real Redis: non-expiring keys, newer-wins by `occurredAt`.
 * Runs when LANGWATCH_TEST_REDIS_URL (or REDIS_URL) names a Redis; skipped otherwise.
 * @see modules/presence/specs/presence.feature
 */
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PresenceSettingsService } from "../../../services/presence-settings.service.ts";
import { RedisPresenceSettingsRepository } from "../redis.presence-settings.repository.ts";

const projectKey = (id: string) => RedisPresenceSettingsRepository.projectKey(id);
const organizationKey = (id: string) => RedisPresenceSettingsRepository.organizationKey(id);

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL;
const PROJECT = { projectId: "presence-fold-project", organizationId: "presence-fold-org" };

describe.skipIf(!redisUrl)("given presence's settings fold in Redis", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(redisUrl!);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.del(projectKey(PROJECT.projectId), organizationKey(PROJECT.organizationId));
  });

  /** @scenario "Folded presence settings are durable and outlive every session" */
  it("stores both settings without an expiry and answers from them on a fresh read", async () => {
    const writer = PresenceSettingsService.create({
      repository: RedisPresenceSettingsRepository.create(redis),
    });
    await writer.projectSettingChanged({ ...PROJECT, presenceEnabled: true, occurredAt: 1 });
    await writer.organizationSettingChanged({
      organizationId: PROJECT.organizationId,
      presenceEnabled: false,
      occurredAt: 1,
    });

    expect(await redis.ttl(projectKey(PROJECT.projectId))).toBe(-1);
    expect(await redis.ttl(organizationKey(PROJECT.organizationId))).toBe(-1);
    const reader = PresenceSettingsService.create({
      repository: RedisPresenceSettingsRepository.create(redis),
    });
    await expect(reader.isEnabledForProject({ projectId: PROJECT.projectId })).resolves.toBe(false);
  });

  it("keeps the newer setting when an older one arrives late, as the memory twin does", async () => {
    const repository = RedisPresenceSettingsRepository.create(redis);
    await repository.recordProjectSetting({ ...PROJECT, presenceEnabled: false, occurredAt: 20 });
    await repository.recordProjectSetting({ ...PROJECT, presenceEnabled: true, occurredAt: 10 });
    await repository.recordProject(PROJECT);

    await expect(repository.getProject({ projectId: PROJECT.projectId })).resolves.toEqual({
      kind: "folded",
      organizationId: PROJECT.organizationId,
      setting: "off",
    });
    await expect(
      repository.getOrganizationSetting({ organizationId: PROJECT.organizationId }),
    ).resolves.toBe("unrecorded");
  });
});
