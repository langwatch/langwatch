import {
  WebhookEventsService as WebhookEventsServiceContract,
  type ListWebhookEventsQuery,
  type ListWebhookEventsResult,
  type WebhookEnvelope,
} from "@langwatch/enterprise-webhook-contract";
import type { WebhookEventsRepository } from "../repositories/webhook-events.repository";
import { WebhookTenantsRepository } from "../repositories/webhook-tenants.repository";
import { WebhookEnvelopeService } from "./webhook-envelope.service";

export type WebhookEventsServiceOptions = {
  tenants: WebhookTenantsRepository;
  events: WebhookEventsRepository;
  envelopes: WebhookEnvelopeService;
};

export type WebhookProjectReader = {
  project: {
    findMany(input: {
      where: { team: { organizationId: string } };
      select: { id: true };
      orderBy: { id: "asc" };
    }): Promise<Array<{ id: string }>>;
  };
};

export type LegacyWebhookEventsServiceOptions = {
  prisma: WebhookProjectReader;
  repository: WebhookEventsRepository;
};

class StructuralWebhookTenantsRepository extends WebhookTenantsRepository {
  constructor(private readonly database: WebhookProjectReader) {
    super();
  }

  async tenantIdsForOrganization(organizationId: string): Promise<string[]> {
    const rows = await this.database.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  }
}

export class WebhookEventsService extends WebhookEventsServiceContract {
  private readonly options: WebhookEventsServiceOptions;

  constructor(options: WebhookEventsServiceOptions | LegacyWebhookEventsServiceOptions) {
    super();
    this.options =
      "prisma" in options
        ? {
            tenants: new StructuralWebhookTenantsRepository(options.prisma),
            events: options.repository,
            envelopes: WebhookEnvelopeService.create(),
          }
        : options;
  }

  static create(
    options: WebhookEventsServiceOptions | LegacyWebhookEventsServiceOptions,
  ): WebhookEventsService {
    return new WebhookEventsService(options);
  }

  async tryGetEmittedEventById(input: {
    organizationId: string;
    id: string;
  }): Promise<WebhookEnvelope | null> {
    const row = await this.options.events.tryReadEmittedEventById({
      tenantIds: await this.options.tenants.tenantIdsForOrganization(
        input.organizationId,
      ),
      id: input.id,
    });
    return row ? this.options.envelopes.fromSpendRow(row) : null;
  }

  async getEmittedEvents(
    query: ListWebhookEventsQuery,
  ): Promise<ListWebhookEventsResult> {
    const page = await this.options.events.readEmittedEventsPage({
      tenantIds: await this.options.tenants.tenantIdsForOrganization(
        query.organizationId,
      ),
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
