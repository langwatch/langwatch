/**
 * Where an entry lives: Redis when the deployment has one, an in-process map
 * otherwise. Both expire the entry on their own, so nothing sweeps.
 *
 * The key is `${projectId}:${name}`, and the route's name rule keeps a colon
 * and a wildcard out of the name half, so one project can never address
 * another project's entry.
 *
 * Two concurrent runs in the same project that write the same entry name see
 * last-write-wins on both writes and deletes. That is accepted: entries are
 * project-scoped so a second run can reuse a session the first run wrote,
 * and every code sandbox in a project already receives every project secret.
 * Docs caution agent authors to pick collision-resistant names when a project
 * runs several distinct agents at the same time.
 *
 * Every worktree on a developer machine shares one Redis database, so two
 * stacks that use the same project id and the same entry name read each
 * other's entries. That is local only: a deployment has its own Redis.
 *
 * The store arrives as a PORT rather than being the trace vertical's
 * module-level `TtlCache` singleton: the process owns its connection, and a
 * cache that registered itself would make two processes in one test share an
 * entry keyspace.
 */
const AGENT_CACHE_KEY_PREFIX = "ttlcache:agent-cache:";

/**
 * The expiring key-value store one entry lives in.
 *
 * `claim` is `SET key value EX <seconds> NX` — the write that answers whether
 * this caller is the one that took the name. It is on the port rather than
 * built from `get`-then-`set` because the two-step version has a window in
 * which two runs both believe they won.
 */
export abstract class AgentCacheEntryStorePort {
  abstract get(key: string): Promise<string | undefined>;
  abstract set(key: string, value: string, ttlMs: number): Promise<void>;
  abstract claim(key: string, value: string, ttlMs: number): Promise<boolean>;
  abstract delete(key: string): Promise<void>;
}

export class AgentCacheRepository {
  constructor(private readonly store: AgentCacheEntryStorePort) {}

  private key({ projectId, name }: { projectId: string; name: string }) {
    return `${AGENT_CACHE_KEY_PREFIX}${projectId}:${name}`;
  }

  async findByName({
    projectId,
    name,
  }: {
    projectId: string;
    name: string;
  }): Promise<string | undefined> {
    return this.store.get(this.key({ projectId, name }));
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
    await this.store.set(this.key({ projectId, name }), encryptedValue, ttlMs);
  }

  /**
   * Write only when the project holds no live entry under this name.
   * Answers whether this caller is the one that took it.
   */
  async claim({
    projectId,
    name,
    encryptedValue,
    ttlMs,
  }: {
    projectId: string;
    name: string;
    encryptedValue: string;
    ttlMs: number;
  }): Promise<boolean> {
    return this.store.claim(this.key({ projectId, name }), encryptedValue, ttlMs);
  }

  async delete({ projectId, name }: { projectId: string; name: string }): Promise<void> {
    await this.store.delete(this.key({ projectId, name }));
  }
}
