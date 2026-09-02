import { createLogger, type Logger } from "@langwatch/observability";
import {
  TenantBroadcastPort,
  TenantBroadcastPublisherPort,
  type TenantBroadcastEventType,
  type TenantBroadcastMessage,
} from "../ports/tenant-broadcast.port";

/**
 * One publish onto the tenant's channel, and nothing else.
 *
 * The application's `BroadcastService` does three things — publish, subscribe,
 * and emit locally to the tabs this process is serving. A background process
 * has no tabs, so the local-emission fallback that service takes when Redis is
 * absent or a publish fails would deliver to nobody here. This adapter
 * therefore has no fallback path at all: it publishes, or it reports that it
 * could not.
 *
 * A failed publish does NOT throw. Every caller reaches this after a durable
 * write already succeeded, and the browser refetches on its own schedule
 * regardless; failing the job would re-run work that is already done in order
 * to retry a courtesy. The failure is logged at error so it is visible as what
 * it is — a screen that stopped moving — rather than inferred from a customer
 * report.
 *
 * ## The frozen twin
 *
 * Channel and body are pinned by literal in this adapter's test, not derived
 * from anything the subscriber shares. The subscriber lives in the application
 * (`broadcast.service.ts`), matches the channel by exact string and
 * destructures `{ tenantId, event }` out of the parsed body. Drift in either
 * direction is silent: an unknown channel is accepted by Redis and delivered to
 * nobody, and a body missing `tenantId` is dropped inside the subscriber's own
 * try/catch. Neither raises anything anywhere.
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
