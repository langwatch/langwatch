// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HandledError } from "@langwatch/handled-error";
import type { PrismaClient } from "~/generated/prisma/client";
import { spendRowToEnvelope, type WebhookEnvelope } from "./envelope";
import type { WebhookEventsClickHouseRepository } from "./webhookEvents.clickhouse.repository";

/**
 * The events log cannot answer for this id.
 *
 * One refusal for every reason it cannot: the id names no event we ever
 * emitted, the event has aged past the log's retention horizon, or it belongs
 * to another organization. Separating them would let a caller confirm that a
 * request id exists in a tenant it cannot read, so the endpoint answers
 * identically in all three cases.
 */
export class WebhookEventNotFoundError extends HandledError {
  declare readonly code: "webhook_event_not_found";

  constructor() {
    super(
      "webhook_event_not_found",
      "That event is not in this organization's log",
      { httpStatus: 404, fault: "customer" },
    );
    this.name = "WebhookEventNotFoundError";
  }
}

export interface WebhookEventsServiceDeps {
  prisma: PrismaClient;
  repository: WebhookEventsClickHouseRepository;
}

/**
 * The emitted-events listing behind GET /api/webhooks/v1/events: resolves
 * the organization's tenant set and pages the spend records as envelopes.
 * Routes call this service; the repository stays a read detail.
 */
export class WebhookEventsService {
  constructor(private readonly deps: WebhookEventsServiceDeps) {}

  /** The org's tenant set, ordered so client routing is stable across calls. */
  private async tenantIdsFor(organizationId: string): Promise<string[]> {
    const projects = await this.deps.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return projects.map((p) => p.id);
  }

  /** One emitted event by id, or null when this log does not hold it. */
  async getEmittedEventById(params: {
    organizationId: string;
    id: string;
  }): Promise<WebhookEnvelope | null> {
    const row = await this.deps.repository.readEmittedEventById({
      tenantIds: await this.tenantIdsFor(params.organizationId),
      id: params.id,
    });
    return row ? spendRowToEnvelope(row) : null;
  }

  async getEmittedEvents(params: {
    organizationId: string;
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    types?: string[];
  }): Promise<{ events: WebhookEnvelope[]; nextCursor: string | null }> {
    const page = await this.deps.repository.readEmittedEventsPage({
      tenantIds: await this.tenantIdsFor(params.organizationId),
      fromMs: params.fromMs,
      toMs: params.toMs,
      cursor: params.cursor ?? null,
      limit: params.limit,
      types: params.types,
    });
    return {
      events: page.rows.map(spendRowToEnvelope),
      nextCursor: page.nextCursor,
    };
  }
}
