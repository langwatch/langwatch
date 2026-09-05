import { createLogger, type Logger } from "@langwatch/observability";
import {
  TenantBroadcastPort,
  TenantBroadcastPublisherPort,
  type TenantBroadcastEventType,
  type TenantBroadcastMessage,
} from "../ports/tenant-broadcast.port";

/**
 * One publish onto the tenant's channel, and nothing else. The application's `BroadcastAdapter`
 * does three things — publish, subscribe, and emit locally to the tabs this process is serving.
 */
export class RedisTenantBroadcastAdapter extends TenantBroadcastPort {
  static create(options: {
    publisher: TenantBroadcastPublisherPort;
    logger?: Logger;
  }): RedisTenantBroadcastAdapter {
    return new RedisTenantBroadcastAdapter(
      options.publisher,
      options.logger ?? createLogger("langwatch:tenant-broadcast"),
      () => Date.now(),
    );
  }

  /** Composed with an explicit clock so the twin test can pin the body's bytes. */
  static createWithClock(options: {
    publisher: TenantBroadcastPublisherPort;
    logger?: Logger;
    now: () => number;
  }): RedisTenantBroadcastAdapter {
    return new RedisTenantBroadcastAdapter(
      options.publisher,
      options.logger ?? createLogger("langwatch:tenant-broadcast"),
      options.now,
    );
  }

  private constructor(
    private readonly publisher: TenantBroadcastPublisherPort,
    private readonly logger: Logger,
    private readonly now: () => number,
  ) {
    super();
  }

  async broadcastToTenant(input: {
    tenantId: string;
    event: string;
    eventType: TenantBroadcastEventType;
  }): Promise<void> {
    const channel = TenantBroadcastPort.channelFor(input.eventType);
    const message: TenantBroadcastMessage = {
      tenantId: input.tenantId,
      event: input.event,
      timestamp: this.now(),
    };

    try {
      await this.publisher.publish(channel, JSON.stringify(message));
    } catch (error) {
      // The event body is not logged. It is a tenant's own payload, and this
      // line exists to say a channel went quiet, not to reproduce what it
      // would have carried.
      this.logger.error(
        {
          tenantId: input.tenantId,
          eventType: input.eventType,
          error: error instanceof Error ? error.message : String(error),
        },
        "Could not publish a tenant broadcast; open tabs will not refresh until they refetch",
      );
    }
  }
}
