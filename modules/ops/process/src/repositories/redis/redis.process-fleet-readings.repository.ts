import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import {
  type ProcessFleetSnapshot,
  ProcessFleetReadingsRepository,
  processFleetSnapshotSchema,
} from "../process-fleet-readings.repository.ts";

const logger = createLogger("langwatch:ops:process-fleet");
const HELD_FOR_SECONDS = 30 * 60;

/** One JSON value that expires, so a fleet nobody measures any more stops reporting. */
export class RedisProcessFleetReadingsRepository extends ProcessFleetReadingsRepository {
  private static readonly key = "ops:process_fleet:readings";

  static create({ redis }: { redis: IORedis | Cluster }): RedisProcessFleetReadingsRepository {
    return new RedisProcessFleetReadingsRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async save(snapshot: ProcessFleetSnapshot): Promise<void> {
    await this.redis.set(
      RedisProcessFleetReadingsRepository.key,
      JSON.stringify(snapshot),
      "EX",
      HELD_FOR_SECONDS,
    );
  }

  async find(): Promise<ProcessFleetSnapshot | null> {
    const raw = await this.redis.get(RedisProcessFleetReadingsRepository.key);
    if (raw === null) return null;
    const snapshot = processFleetSnapshotSchema.safeParse(readJson(raw));
    if (snapshot.success) return snapshot.data;

    logger.debug({ issues: snapshot.error.issues }, "skipped fleet readings held in another shape");
    return null;
  }
}

function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Not JSON at all: the schema refuses undefined and the caller logs it.
    return undefined;
  }
}
