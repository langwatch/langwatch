import {
  WebhookDispatchRateLimiter,
  WebhookEgressService,
  type WebhookDispatchRateLimitResult,
} from "@langwatch/egress";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { WebhookDispatchResult } from "../../app/webhook.app.ts";
import { HttpWebhookDestinationAdapter } from "../../services/http.webhook-destination.service.ts";
import type { WebhookDispatchChannel, WebhookDispatchInput } from "../webhook-dispatch.channel.ts";

const logger = createLogger("langwatch:webhooks:dispatch");

/** The three counter calls the dispatch cap makes on the process Redis member. */
export interface WebhookDispatchCounter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

/**
 * Main's `dispatchWebhookThrough` for a process with no AWS transport: HTTPS endpoints go
 * through the SSRF-fenced egress, a queue endpoint answers main's terminal refusal.
 */
export class EgressWebhookDispatchChannel implements WebhookDispatchChannel {
  static create(input: {
    redis: WebhookDispatchCounter;
    rejectUnauthorized: boolean;
    allowInsecureLocal: boolean;
  }): EgressWebhookDispatchChannel {
    return new EgressWebhookDispatchChannel(
      WebhookEgressService.create({
        rateLimiter: new RedisWebhookDispatchRateLimiter(input.redis),
        tls: { rejectUnauthorized: input.rejectUnauthorized },
      }),
      input.allowInsecureLocal,
    );
  }

  private constructor(
    private readonly egress: WebhookEgressService,
    private readonly allowInsecureLocal: boolean,
  ) {}

  dispatch = (input: WebhookDispatchInput): Promise<WebhookDispatchResult> => {
    if (input.destination.kind === "sqs") {
      logger.error(
        { organizationId: input.organizationId, endpointId: input.endpointId },
        "webhook endpoint delivers to a queue, and this process composes no AWS transport",
      );
      return Promise.resolve({
        verdict: "terminal",
        status: null,
        body: "",
        dispatchId: input.batchId,
        error: "This process composes no AWS transport for queue webhook destinations.",
      });
    }
    return HttpWebhookDestinationAdapter.create({
      url: input.destination.url,
      egress: this.egress,
      allowInsecureLocal: this.allowInsecureLocal,
    }).send({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
      body: input.body,
      batchId: input.batchId,
      attempt: input.attempt,
      signingSecrets: input.signingSecrets,
    });
  };
}

/** The hourly dispatch cap under main's key prefix, shared with automation's alert webhooks. */
class RedisWebhookDispatchRateLimiter extends WebhookDispatchRateLimiter {
  constructor(private readonly connection: WebhookDispatchCounter) {
    super();
  }

  async limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<WebhookDispatchRateLimitResult> {
    const redisKey = `langwatch:ratelimit:${input.key}`;
    const count = await this.connection.incr(redisKey);
    if (count === 1) {
      await this.connection.expire(redisKey, input.windowSeconds);
    }
    const ttl = await this.connection.ttl(redisKey);
    return {
      allowed: count <= input.max,
      remaining: Math.max(0, input.max - count),
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  }
}
