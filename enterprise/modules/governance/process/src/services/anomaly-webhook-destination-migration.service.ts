// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type AnomalyDestination,
  type AnomalyRule,
  destinationConfigSchema,
  type WebhookDestination,
} from "@langwatch/enterprise-governance-contract";
import {
  ORGANIZATION_ID_PAGE_LIMIT,
  type OrganizationIdPage,
  type OrganizationIdPageInput,
} from "@langwatch/organization-contract";
import type { CreateWebhookEndpointCommand } from "@langwatch/webhook-contract";

import type { AnomalyRuleRepository } from "../repositories/anomaly-rule.repository.ts";

type MigrationCollaborators = {
  rules: Pick<AnomalyRuleRepository, "findAll" | "findById" | "updateIfUnchanged">;
  organizationIds: (input: OrganizationIdPageInput) => Promise<OrganizationIdPage>;
  createEndpoint: (command: CreateWebhookEndpointCommand) => Promise<{ endpoint: { id: string } }>;
  archiveEndpoint: (input: { organizationId: string; endpointId: string }) => Promise<void>;
  /** The one event a migrated endpoint subscribes to. */
  alertEventType: string;
};

type MigrationTotals = { organizations: number; rules: number; endpoints: number };

/**
 * W-11: each inline webhook destination gains a legacy-scheme endpoint signed with the rule's
 * secret, keeping its URL so an older image still delivers inline (Alex, 2026-10-09, D1-A).
 * The create is keyed per rule and position, so a rerun reuses it. The write lands only on the
 * rule as read, else it is re-read; endpoints the final rule does not name are archived.
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
      for (const organizationId of page.ids) {
        if (signal?.aborted) break;
        await this.migrateOrganization({ organizationId, dryRun, totals, signal });
      }
      // A page an abort reached is redone from the last saved cursor.
      const completed = !signal?.aborted;
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
    signal,
  }: {
    organizationId: string;
    dryRun: boolean;
    totals: MigrationTotals;
    signal: AbortSignal | undefined;
  }): Promise<void> {
    totals.organizations += 1;
    for (const rule of await this.collaborators.rules.findAll(organizationId)) {
      if (signal?.aborted) return;
      const parsed = destinationConfigSchema.safeParse(rule.destinationConfig);
      if (!parsed.success) continue;
      const inline = parsed.data.destinations.filter(isUnmigrated).length;
      if (inline === 0) continue;
      totals.rules += 1;
      totals.endpoints += inline;
      if (dryRun) continue;
      await this.migrateRule({ organizationId, rule, signal });
    }
  }

  private async migrateRule({
    organizationId,
    rule,
    signal,
  }: {
    organizationId: string;
    rule: AnomalyRule;
    signal: AbortSignal | undefined;
  }): Promise<void> {
    const made = new Set<string>();
    let kept = new Set<string>();
    let current: AnomalyRule | null = rule;
    while (current !== null && current.archivedAt === null && !signal?.aborted) {
      const parsed = destinationConfigSchema.safeParse(current.destinationConfig);
      if (!parsed.success || !parsed.data.destinations.some(isUnmigrated)) break;
      const attempt = new Set<string>();
      const destinations: AnomalyDestination[] = [];
      for (const [index, destination] of parsed.data.destinations.entries()) {
        if (!isUnmigrated(destination)) {
          destinations.push(destination);
          continue;
        }
        const endpointId = await this.endpointFor({
          organizationId,
          destination,
          idempotencyKey: `anomaly-rule:${current.id}:${index}`,
        });
        made.add(endpointId);
        attempt.add(endpointId);
        destinations.push({ ...destination, endpointId });
      }
      const written = await this.collaborators.rules.updateIfUnchanged({
        id: current.id,
        updatedAt: current.updatedAt,
        changes: { destinationConfig: { destinations } },
      });
      if (written) {
        kept = attempt;
        break;
      }
      current = await this.collaborators.rules.findById(current.id);
    }
    // Stopped as a crash would: a rerun reuses the endpoints made so far by their keys.
    if (signal?.aborted) return;
    await this.archiveUnkept({ organizationId, made, kept });
  }

  private async archiveUnkept({
    organizationId,
    made,
    kept,
  }: {
    organizationId: string;
    made: ReadonlySet<string>;
    kept: ReadonlySet<string>;
  }): Promise<void> {
    for (const endpointId of made) {
      if (!kept.has(endpointId)) {
        await this.collaborators.archiveEndpoint({ organizationId, endpointId });
      }
    }
  }

  private async endpointFor({
    organizationId,
    destination,
    idempotencyKey,
  }: {
    organizationId: string;
    destination: WebhookDestination;
    idempotencyKey: string;
  }): Promise<string> {
    const { endpoint } = await this.collaborators.createEndpoint({
      organizationId,
      destinationKind: "http",
      url: destination.url,
      enabledEvents: [this.collaborators.alertEventType],
      signatureScheme: "legacy_sha256",
      ...(destination.sharedSecret === undefined ? {} : { sharedSecret: destination.sharedSecret }),
      idempotencyKey,
    });
    return endpoint.id;
  }
}

/** An inline webhook destination the migration has not yet given an endpoint. */
function isUnmigrated(destination: AnomalyDestination): destination is WebhookDestination {
  return destination.type === "webhook" && destination.endpointId === undefined;
}
