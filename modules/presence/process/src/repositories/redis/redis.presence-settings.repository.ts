import type { RedisConnection } from "@langwatch/redis-client";

import {
  type FoldedProject,
  type FoldedSetting,
  PresenceSettingsRepository,
  type RecordedSetting,
} from "../presence-settings.repository.ts";

const KEY_PREFIX = "presence:settings:v1";

/** Writes `enabled`/`at` only when no newer setting is stored; one key, so cluster-safe. */
const RECORD_NEWER_SETTING = `
local stored = redis.call('HGET', KEYS[1], 'at')
if ARGV[3] ~= '' then redis.call('HSET', KEYS[1], 'organizationId', ARGV[3]) end
if stored and tonumber(stored) > tonumber(ARGV[2]) then return 0 end
redis.call('HSET', KEYS[1], 'enabled', ARGV[1], 'at', ARGV[2])
return 1
`;

/** Non-expiring hashes: a fold must outlive every session TTL beside it. */
export class RedisPresenceSettingsRepository extends PresenceSettingsRepository {
  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  static create(redis: RedisConnection): RedisPresenceSettingsRepository {
    return new RedisPresenceSettingsRepository(redis);
  }

  async recordProject({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<void> {
    await this.redis.hset(
      RedisPresenceSettingsRepository.projectKey(projectId),
      "organizationId",
      organizationId,
    );
  }

  async recordProjectSetting({
    projectId,
    organizationId,
    presenceEnabled,
    occurredAt,
  }: { projectId: string; organizationId: string } & RecordedSetting): Promise<void> {
    await this.redis.eval(
      RECORD_NEWER_SETTING,
      1,
      RedisPresenceSettingsRepository.projectKey(projectId),
      flag(presenceEnabled),
      String(occurredAt),
      organizationId,
    );
  }

  async recordOrganizationSetting({
    organizationId,
    presenceEnabled,
    occurredAt,
  }: { organizationId: string } & RecordedSetting): Promise<void> {
    await this.redis.eval(
      RECORD_NEWER_SETTING,
      1,
      RedisPresenceSettingsRepository.organizationKey(organizationId),
      flag(presenceEnabled),
      String(occurredAt),
      "",
    );
  }

  async getProject({ projectId }: { projectId: string }): Promise<FoldedProject> {
    const [organizationId, enabled] = await this.redis.hmget(
      RedisPresenceSettingsRepository.projectKey(projectId),
      "organizationId",
      "enabled",
    );
    if (!organizationId) return { kind: "unfolded" };
    return { kind: "folded", organizationId, setting: settingOf(enabled) };
  }

  async getOrganizationSetting({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<FoldedSetting> {
    return settingOf(
      await this.redis.hget(
        RedisPresenceSettingsRepository.organizationKey(organizationId),
        "enabled",
      ),
    );
  }

  static projectKey(projectId: string): string {
    return `${KEY_PREFIX}:project:${projectId}`;
  }

  static organizationKey(organizationId: string): string {
    return `${KEY_PREFIX}:organization:${organizationId}`;
  }
}

function flag(presenceEnabled: boolean): string {
  return presenceEnabled ? "1" : "0";
}

function settingOf(stored: string | null | undefined): FoldedSetting {
  if (stored === "1") return "on";
  if (stored === "0") return "off";
  return "unrecorded";
}
