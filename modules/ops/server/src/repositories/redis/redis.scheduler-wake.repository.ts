import { SchedulerWakePort } from "../../ports/scheduler-wake.port.ts";

const SCHEDULER_WAKE_CHANNEL = "scheduler:wake";

export interface SchedulerWakeRedis {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Best-effort cross-process wake for the app-owned scheduler loop. */
export class RedisSchedulerWakeRepository extends SchedulerWakePort {
  private constructor(private readonly redis: SchedulerWakeRedis) {
    super();
  }

  static create(redis: SchedulerWakeRedis): RedisSchedulerWakeRepository {
    return new RedisSchedulerWakeRepository(redis);
  }

  wake(): void {
    void this.redis.publish(SCHEDULER_WAKE_CHANNEL, "1").catch(() => {
      // The scheduler's polling backstop preserves correctness when Redis is unavailable.
    });
  }
}
