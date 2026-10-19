/**
 * The daily ceiling, counted fleet-wide on the process's Redis. THE KEY FORMAT
 * IS FROZEN: a live deployment holds today's counters and claims under it.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import type { Instant } from "@langwatch/time";

import { derivePersistCapDay } from "../../rules/persist-cap.rules.ts";
import {
  AutomationPersistCapRepository,
  type PersistCapSlotCount,
  type PersistCapSlotRef,
  type PersistCapTriggerCount,
} from "../automation-persist-cap.repository.ts";
import { MemoryAutomationPersistCapRepository } from "../memory/memory.automation-persist-cap.repository.ts";

const EXPIRE_SECONDS = 90_000;

/** How many count reads run at once: separate hash slots forbid MGET. */
const COUNT_READ_CHUNK = 100;

/**
 * Claim, count and expire atomically. The TTL check retains Redis 6 support and
 * prevents both immortal counters and a sliding expiry.
 */
const CLAIM_AND_COUNT_SCRIPT = `
local claimed = redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX')
if not claimed then
  return tonumber(redis.call('GET', KEYS[2]) or '0')
end
local count = redis.call('INCR', KEYS[2])
if redis.call('TTL', KEYS[2]) < 0 then
  redis.call('EXPIRE', KEYS[2], ARGV[1])
end
return count
`;

/** A consume that cannot reach Redis counts per worker and says so; a read failure propagates. */
export class RedisAutomationPersistCapRepository extends AutomationPersistCapRepository {
  static create(input: {
    connection: Pick<RedisConnection, "eval" | "get">;
    logger?: Pick<Logger, "error" | "warn"> | undefined;
  }): RedisAutomationPersistCapRepository {
    const logger = input.logger ?? createLogger("langwatch:automations:persist-cap");
    return new RedisAutomationPersistCapRepository(
      input.connection,
      logger,
      MemoryAutomationPersistCapRepository.create({ logger }),
    );
  }

  /** `persist-cap:<tag>:<utcDay>`; the braced tag keeps counter and claim in one Cluster slot. */
  static counterKey(input: { projectId: string; triggerId: string; now: Instant }): string {
    return `persist-cap:${slotTag(input)}:${derivePersistCapDay(input.now)}`;
  }

  /** `persist-cap-claimed:<tag>:<dedupKey>`, sharing the counter's slot. */
  static claimKey(input: { projectId: string; triggerId: string; dedupKey: string }): string {
    return `persist-cap-claimed:${slotTag(input)}:${input.dedupKey}`;
  }

  readonly #connection: Pick<RedisConnection, "eval" | "get">;
  readonly #logger: Pick<Logger, "error">;
  readonly #perWorker: MemoryAutomationPersistCapRepository;

  private constructor(
    connection: Pick<RedisConnection, "eval" | "get">,
    logger: Pick<Logger, "error">,
    perWorker: MemoryAutomationPersistCapRepository,
  ) {
    super();
    this.#connection = connection;
    this.#logger = logger;
    this.#perWorker = perWorker;
  }

  async consumeSlot(slot: PersistCapSlotRef): Promise<PersistCapSlotCount> {
    const key = RedisAutomationPersistCapRepository.counterKey(slot);
    try {
      const count = await this.#connection.eval(
        CLAIM_AND_COUNT_SCRIPT,
        2,
        RedisAutomationPersistCapRepository.claimKey(slot),
        key,
        String(EXPIRE_SECONDS),
      );
      return { outcome: "counted", count: Number(count) };
    } catch (error) {
      // A throw would replay the dispatch's side effect; the per-worker count keeps a ceiling.
      this.#logger.error(
        { key, error },
        "Redis error consuming an automation persist cap slot — the ceiling " +
          "is DEGRADED to per-worker in-memory counters until Redis recovers",
      );
      const perWorker = await this.#perWorker.consumeSlot(slot);
      return { outcome: "degraded", count: perWorker.count };
    }
  }

  async findCounts(input: {
    projectId: string;
    triggerIds: readonly string[];
    now: Instant;
  }): Promise<PersistCapTriggerCount[]> {
    const counts: PersistCapTriggerCount[] = [];
    for (let start = 0; start < input.triggerIds.length; start += COUNT_READ_CHUNK) {
      const chunk = input.triggerIds.slice(start, start + COUNT_READ_CHUNK);
      const raw = await Promise.all(
        chunk.map((triggerId) =>
          this.#connection.get(
            RedisAutomationPersistCapRepository.counterKey({
              projectId: input.projectId,
              triggerId,
              now: input.now,
            }),
          ),
        ),
      );
      chunk.forEach((triggerId, index) => {
        counts.push({ triggerId, count: raw[index] ? Number(raw[index]) : 0 });
      });
    }
    return counts;
  }
}

function slotTag({ projectId, triggerId }: { projectId: string; triggerId: string }): string {
  return `{${projectId}:${triggerId}}`;
}
