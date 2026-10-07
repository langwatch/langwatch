import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  type ListWebhookEventsQuery,
  type ListWebhookEventsResult,
  type WebhookEnvelope,
} from "@langwatch/webhook-contract";

import { parseSpendEventId, spendStatusesForTypes } from "../rules/webhook-spend-event-id.rules.ts";
import type { WebhookEnvelopeService } from "./webhook-envelope.service.ts";

export type WebhookEventsServiceOptions = {
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  /** Gateway owns gateway_spend; webhook reads its emitted events through gateway's Api. */
  spend: Pick<GatewayApi, "listSpendEventsAcrossTenants" | "findSpendEventAcrossTenants">;
  envelopes: WebhookEnvelopeService;
};

export class WebhookEventsService {
  private readonly options: WebhookEventsServiceOptions;

  private constructor(options: WebhookEventsServiceOptions) {
    this.options = options;
  }

  static create(options: WebhookEventsServiceOptions): WebhookEventsService {
    return new WebhookEventsService(options);
  }

  async findEmittedEventById(input: {
    organizationId: string;
    id: string;
  }): Promise<WebhookEnvelope | null> {
    const parsed = parseSpendEventId(input.id);
    if (!parsed) return null;
    const row = await this.options.spend.findSpendEventAcrossTenants({
      tenantIds: await this.options.projects.listIdsByOrganization({
        organizationId: input.organizationId,
      }),
      gatewayRequestId: parsed.gatewayRequestId,
      statuses: parsed.statuses,
    });

    return row ? this.options.envelopes.fromSpendRow(row) : null;
  }

  async getEmittedEvents(query: ListWebhookEventsQuery): Promise<ListWebhookEventsResult> {
    const statuses = spendStatusesForTypes(query.types);
    const tenantIds = await this.options.projects.listIdsByOrganization({
      organizationId: query.organizationId,
    });
    if (tenantIds.length === 0 || statuses.length === 0) return { events: [], nextCursor: null };
    const page = await this.options.spend.listSpendEventsAcrossTenants({
      tenantIds,
      statuses,
      fromMs: query.fromMs,
      toMs: query.toMs,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });

    return {
      events: page.rows.map((row) => this.options.envelopes.fromSpendRow(row)),
      nextCursor: page.nextCursor,
    };
  }
}
