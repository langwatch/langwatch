import {
  type ListWebhookEventsQuery,
  type ListWebhookEventsResult,
  type WebhookEnvelope,
} from "@langwatch/webhook-contract";

import type { WebhookEventsRepository } from "../repositories/webhook-events.repository.ts";
import type { WebhookTenantsRepository } from "../repositories/webhook-tenants.repository.ts";
import type { WebhookEnvelopeService } from "./webhook-envelope.service.ts";

export type WebhookEventsServiceOptions = {
  tenants: WebhookTenantsRepository;
  events: WebhookEventsRepository;
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
    const row = await this.options.events.findEmittedEventById({
      tenantIds: await this.options.tenants.tenantIdsForOrganization(input.organizationId),
      id: input.id,
    });

    return row ? this.options.envelopes.fromSpendRow(row) : null;
  }

  async getEmittedEvents(query: ListWebhookEventsQuery): Promise<ListWebhookEventsResult> {
    const page = await this.options.events.readEmittedEventsPage({
      tenantIds: await this.options.tenants.tenantIdsForOrganization(query.organizationId),
      fromMs: query.fromMs,
      toMs: query.toMs,
      cursor: query.cursor ?? null,
      limit: query.limit,
      types: query.types,
    });

    return {
      events: page.rows.map((row) => this.options.envelopes.fromSpendRow(row)),
      nextCursor: page.nextCursor,
    };
  }
}
