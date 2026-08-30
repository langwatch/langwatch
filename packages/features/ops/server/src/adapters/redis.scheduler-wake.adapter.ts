import { SchedulerWakeService } from "../ports/scheduler-wake.service";

const SCHEDULER_WAKE_CHANNEL = "scheduler:wake";

export interface SchedulerWakeRedis {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Best-effort cross-process wake for the app-owned scheduler loop. */
export class RedisSchedulerWakeAdapter extends SchedulerWakeService {
  private constructor(private readonly redis: SchedulerWakeRedis) {
    super();
  }

  static create(redis: SchedulerWakeRedis): RedisSchedulerWakeAdapter {
    return new RedisSchedulerWakeAdapter(redis);
  }

  wake(): void {
    void this.redis.publish(SCHEDULER_WAKE_CHANNEL, "1").catch(() => {
      // The scheduler's polling backstop preserves correctness when Redis is unavailable.
    });
  }
}
