// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { WebhookEventsClickHouseRepository } from "../repositories/clickhouse/clickhouse.webhook-events.repository";
import type { WebhookClickHouseClientResolver } from "../repositories/clickhouse/clickhouse.webhook-events.repository";
import type { WebhookEventsRepositoryPort } from "../ports/webhook-events.port";

/**
 * The composition seam for webhook event reads.
 *
 * A process needs a `WebhookEventsRepositoryPort`; it does not need to know that
 * one is backed by ClickHouse, and until now the only way to get one was to
 * import the ClickHouse class from the package root — which is what
 * `private-runtime-export` reports. This returns the PORT, so a caller ends up
 * holding the contract rather than the implementation, and the implementation
 * can stay private to the feature.
 *
 * Modelled on `WebhookEndpointAdapter`, which does the same for the Prisma
 * endpoint repository.
 */
export class WebhookEventsAdapter {
  private constructor() {}

  static create(resolveClient: WebhookClickHouseClientResolver): WebhookEventsRepositoryPort {
    return WebhookEventsClickHouseRepository.create(resolveClient);
  }
}
