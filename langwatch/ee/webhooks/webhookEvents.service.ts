// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@prisma/client";
import { spendRowToEnvelope, type WebhookEnvelope } from "./envelope";
import type { WebhookEventsClickHouseRepository } from "./webhookEvents.clickhouse.repository";

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

  async getEmittedEvents(params: {
    organizationId: string;
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    types?: string[];
  }): Promise<{ events: WebhookEnvelope[]; nextCursor: string | null }> {
    // Ordered so the repository's client routing by the first tenant is
    // stable across calls.
    const projects = await this.deps.prisma.project.findMany({
      where: { team: { organizationId: params.organizationId } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const page = await this.deps.repository.readEmittedEventsPage({
      tenantIds: projects.map((p) => p.id),
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
