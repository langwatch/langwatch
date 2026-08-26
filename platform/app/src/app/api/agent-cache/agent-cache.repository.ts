import { TtlCache } from "~/server/utils/ttlCache";

/**
 * Where an entry lives: Redis when the deployment has one, an in-process map
 * otherwise. Both expire the entry on their own, so nothing sweeps.
 *
 * The key is `${projectId}:${name}`, and the route's name rule keeps a colon
 * and a wildcard out of the name half, so one project can never address
 * another project's entry.
 *
 * Every worktree on a developer machine shares one Redis database, so two
 * stacks that use the same project id and the same entry name read each
 * other's entries. That is local only: a deployment has its own Redis.
 */
const AGENT_CACHE_KEY_PREFIX = "ttlcache:agent-cache:";

export class AgentCacheRepository {
  private readonly cache: TtlCache<string>;

  constructor({ defaultTtlMs }: { defaultTtlMs: number }) {
    this.cache = new TtlCache<string>(defaultTtlMs, AGENT_CACHE_KEY_PREFIX);
  }

  private key({ projectId, name }: { projectId: string; name: string }) {
    return `${projectId}:${name}`;
  }

  async findByName({
    projectId,
    name,
  }: {
    projectId: string;
    name: string;
  }): Promise<string | undefined> {
    return this.cache.get(this.key({ projectId, name }));
  }

  async put({
    projectId,
    name,
    encryptedValue,
    ttlMs,
  }: {
    projectId: string;
    name: string;
    encryptedValue: string;
    ttlMs: number;
  }): Promise<void> {
    await this.cache.set(this.key({ projectId, name }), encryptedValue, ttlMs);
  }

  async delete({
    projectId,
    name,
  }: {
    projectId: string;
    name: string;
  }): Promise<void> {
    await this.cache.delete(this.key({ projectId, name }));
  }
}
