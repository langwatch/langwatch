// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type AnomalyDestination,
  destinationConfigSchema,
  type WebhookDestination,
  type WebhookEndpointDestination,
} from "@langwatch/enterprise-governance-contract";
import {
  ORGANIZATION_ID_PAGE_LIMIT,
  type OrganizationIdPage,
  type OrganizationIdPageInput,
} from "@langwatch/organization-contract";
import type { CreateWebhookEndpointCommand } from "@langwatch/webhook-contract";

import type { AnomalyRuleRepository } from "../repositories/anomaly-rule.repository.ts";

type MigrationCollaborators = {
  rules: Pick<AnomalyRuleRepository, "findAll" | "update">;
  organizationIds: (input: OrganizationIdPageInput) => Promise<OrganizationIdPage>;
  createEndpoint: (command: CreateWebhookEndpointCommand) => Promise<{ endpoint: { id: string } }>;
  /** The one event a migrated endpoint subscribes to. */
  alertEventType: string;
};

type MigrationTotals = { organizations: number; rules: number; endpoints: number };

/**
 * W-11: each rule's inline webhook destinations become legacy-scheme endpoints signed with the
 * rule's own secret. A rewritten rule has no inline destination left, so a rerun skips it.
 */
export class AnomalyWebhookDestinationMigrationService {
  private constructor(private readonly collaborators: MigrationCollaborators) {}

  static create(collaborators: MigrationCollaborators): AnomalyWebhookDestinationMigrationService {
    return new AnomalyWebhookDestinationMigrationService(collaborators);
  }

  /** Each organisation after `after`, a page at a time; `onPage` hears each completed page's last. */
  async migrate({
    after,
    dryRun = false,
    signal,
    onPage,
  }: {
    after?: string | undefined;
    dryRun?: boolean;
    signal?: AbortSignal;
    onPage?: (page: { afterOrganizationId: string }) => Promise<void>;
  } = {}): Promise<{ afterOrganizationId: string | null } & MigrationTotals> {
    const totals: MigrationTotals = { organizations: 0, rules: 0, endpoints: 0 };
    let cursor = after;
    let hasMore = true;
    while (hasMore && !signal?.aborted) {
      const page = await this.collaborators.organizationIds({
        ...(cursor === undefined ? {} : { after: cursor }),
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      let completed = true;
      for (const organizationId of page.ids) {
        if (signal?.aborted) {
          completed = false;
          break;
        }
        await this.migrateOrganization({ organizationId, dryRun, totals });
      }
      const last = page.ids.at(-1);
      if (completed && last !== undefined) {
        cursor = last;
        await onPage?.({ afterOrganizationId: last });
      }
      hasMore = completed && page.next !== null;
    }
    return { afterOrganizationId: cursor ?? null, ...totals };
  }

  private async migrateOrganization({
    organizationId,
    dryRun,
    totals,
  }: {
    organizationId: string;
    dryRun: boolean;
    totals: MigrationTotals;
  }): Promise<void> {
    totals.organizations += 1;
    for (const rule of await this.collaborators.rules.findAll(organizationId)) {
      const parsed = destinationConfigSchema.safeParse(rule.destinationConfig);
      if (!parsed.success) continue;
      const inline = parsed.data.destinations.filter((each) => each.type === "webhook").length;
      if (inline === 0) continue;
      totals.rules += 1;
      totals.endpoints += inline;
      if (dryRun) continue;
      const destinations: AnomalyDestination[] = [];
      for (const destination of parsed.data.destinations) {
        destinations.push(
          destination.type === "webhook"
            ? await this.endpointFor({ organizationId, destination })
            : destination,
        );
      }
      await this.collaborators.rules.update(rule.id, { destinationConfig: { destinations } });
    }
  }

  private async endpointFor({
    organizationId,
    destination,
  }: {
    organizationId: string;
    destination: WebhookDestination;
  }): Promise<WebhookEndpointDestination> {
    const { endpoint } = await this.collaborators.createEndpoint({
      organizationId,
      destinationKind: "http",
      url: destination.url,
      enabledEvents: [this.collaborators.alertEventType],
      signatureScheme: "legacy_sha256",
      ...(destination.sharedSecret === undefined ? {} : { sharedSecret: destination.sharedSecret }),
    });
    return { type: "webhook_endpoint", endpointId: endpoint.id };
  }
}
