// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import {
  AGENT_REGISTRY_ARD_ENTRY_LIMIT,
  type AgentRegistryEntry,
  type AgentRegistryEventPage,
  type AgentRegistryPage,
  type AgentRegistryStatus,
  type ArdManifest,
  type ArdSearchRequest,
  type ArdSearchResponse,
  GovernanceValidationError,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { eventMatches, type WebhookApi } from "@langwatch/webhook-contract";
import { z } from "zod";

import type {
  AgentRegistryRepository,
  RegistryEntryPosition,
} from "../../../repositories/agent-registry.repository.ts";
import type { DiscoveredAgentRepository } from "../../../repositories/discovered-agent.repository.ts";
import { AGENT_SOURCE_BY_PROVIDER } from "../../agents/rules/agent-inventory.rules.ts";
import { memberNames } from "../../identity/rules/member-names.rules.ts";
import type { AgentRegistryDeliveryIntent } from "../eventing/agent-registry-delivery.process.ts";
import { ardManifestOf, ardPublisherOf, ardSearch } from "../rules/registry-ard.rules.ts";
import {
  discoveredAgentDraft,
  langwatchAgentDraft,
  type RegistryDraft,
} from "../rules/registry-entry.rules.ts";
import { planRegistryChanges, registryTimestamp } from "../rules/registry-reconcile.rules.ts";
import {
  REGISTRY_TRAFFIC_LIMIT_PER_PROJECT,
  REGISTRY_TRAFFIC_WINDOW_MS,
  trafficAgentDrafts,
} from "../rules/registry-traffic.rules.ts";

/** Where the registry records its webhook fan-out; governance's outbox in the worker. */
export interface AgentRegistryDeliveryOutbox {
  record(intents: readonly AgentRegistryDeliveryIntent[]): Promise<void>;
}

const AGENTS_PAGE_LIMIT = 200;
const FAN_OUT_BATCH = 500;
const ORGANIZATION_PAGE_LIMIT = 100;

const entryCursorSchema = z.object({ u: z.string().min(1), i: z.string().min(1) });

function encodeCursor(position: RegistryEntryPosition): string {
  return Buffer.from(JSON.stringify({ u: position.updatedAt, i: position.id })).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): RegistryEntryPosition {
  try {
    const parsed = entryCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return { updatedAt: parsed.u, id: parsed.i };
  } catch {
    throw new GovernanceValidationError("The cursor is not one this listing returned.", {
      formErrors: ["cursor is invalid"],
    });
  }
}

type AgentRegistryDependencies = {
  registry: AgentRegistryRepository;
  discoveredAgents: Pick<DiscoveredAgentRepository, "findForRegistry">;
  agents: Pick<AgentApi, "list" | "platformUrl">;
  projects: Pick<ProjectApi, "findLiveNonGovernanceIdsByOrganization" | "listNamesByIds">;
  organizations: Pick<OrganizationApi, "findMembersWithDepartments" | "listAllIds">;
  traces: Pick<TraceApi, "findAgentsSeen">;
  webhooks: Pick<WebhookApi, "getAll">;
  /** Present in the worker, where the delivery process runs; the api records no fan-out. */
  outbox: () => AgentRegistryDeliveryOutbox | undefined;
  publicBaseUrl: string;
  logger: Logger;
  now: () => Instant;
  newId: () => string;
};

/**
 * The organisation's agent registry: built from every source governance reads, versioned on
 * material change, published as REST, an ARD manifest and a change feed, pushed to webhooks.
 * Spec: enterprise/modules/governance/specs/agent-registry.feature
 */
export class AgentRegistryService {
  private constructor(private readonly deps: AgentRegistryDependencies) {}

  static create({
    logger = createLogger("langwatch:governance:agent-registry"),
    now = nowInstant,
    newId = () => generate("agentreg").toString(),
    ...deps
  }: Omit<AgentRegistryDependencies, "logger" | "now" | "newId"> & {
    logger?: Logger;
    now?: () => Instant;
    newId?: () => string;
  }): AgentRegistryService {
    return new AgentRegistryService({ ...deps, logger, now, newId });
  }

  /** Rebuilds the organisation's entries from its sources, appends what changed, fans it out. */
  async reconcileOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ events: number }> {
    const drafts = await this.draftsOf({ organizationId });
    const now = this.deps.now();
    const events = await this.deps.registry.applyChanges({
      organizationId,
      plan: (stored) => planRegistryChanges({ stored, drafts, now, newId: this.deps.newId }),
    });
    await this.fanOutPending({ organizationId });
    return { events: events.length };
  }

  /** Every organisation the registry already holds, reconciled; the scheduled traffic pass. */
  async reconcileHeldOrganizations({ signal }: { signal?: AbortSignal } = {}): Promise<{
    organizations: number;
  }> {
    let organizations = 0;
    let after: string | undefined;
    let hasMore = true;
    while (hasMore && !signal?.aborted) {
      const ids = await this.deps.registry.findOrganizationIds({
        after,
        limit: ORGANIZATION_PAGE_LIMIT,
      });
      for (const organizationId of ids) {
        await this.reconcileLogged({ organizationId });
        organizations += 1;
      }
      hasMore = ids.length === ORGANIZATION_PAGE_LIMIT;
      after = ids.at(-1);
    }
    return { organizations };
  }

  /** Every organisation, once: the deploy step that fills the registry. */
  async seedAll({
    after,
    signal,
    onPage,
  }: {
    after?: string;
    signal?: AbortSignal;
    onPage?: (page: { afterOrganizationId: string }) => Promise<void>;
  }): Promise<{ afterOrganizationId: string | null; organizations: number }> {
    let cursor = after;
    let organizations = 0;
    let hasMore = true;
    while (hasMore && !signal?.aborted) {
      const page = await this.deps.organizations.listAllIds({
        ...(cursor === undefined ? {} : { after: cursor }),
        limit: ORGANIZATION_PAGE_LIMIT,
      });
      for (const organizationId of page.ids) {
        await this.reconcileLogged({ organizationId });
        organizations += 1;
      }
      const last = page.ids.at(-1);
      if (last !== undefined) {
        cursor = last;
        await onPage?.({ afterOrganizationId: last });
      }
      hasMore = page.next !== null;
    }
    return { afterOrganizationId: cursor ?? null, organizations };
  }

  /** Records a delivery intent per pending event and subscribed endpoint, then marks them. */
  async fanOutPending({ organizationId }: { organizationId: string }): Promise<void> {
    const outbox = this.deps.outbox();
    if (!outbox) return;
    const pending = await this.deps.registry.findUndeliveredEvents({
      organizationId,
      limit: FAN_OUT_BATCH,
    });
    if (pending.length === 0) return;
    const endpoints = (await this.deps.webhooks.getAll({ organizationId })).filter(
      (endpoint) => endpoint.status === "ACTIVE",
    );
    const intents = pending.flatMap((event) =>
      endpoints
        .filter((endpoint) => eventMatches(endpoint.enabledEvents, event.type))
        .map((endpoint) => ({
          organizationId,
          eventId: event.id,
          eventType: event.type,
          endpointId: endpoint.id,
          body: event,
        })),
    );
    await outbox.record(intents);
    await this.deps.registry.markDeliveryRecorded({
      organizationId,
      eventIds: pending.map((event) => event.id),
      at: this.deps.now(),
    });
  }

  async listEntries({
    organizationId,
    limit,
    cursor,
    updatedSince,
    status,
  }: {
    organizationId: string;
    limit: number;
    cursor?: string;
    updatedSince?: string;
    status?: AgentRegistryStatus;
  }): Promise<AgentRegistryPage> {
    const { entries, hasMore } = await this.deps.registry.listEntries({
      organizationId,
      limit,
      ...(cursor ? { after: decodeCursor(cursor) } : {}),
      ...(updatedSince ? { updatedSince: Temporal.Instant.from(updatedSince) } : {}),
      ...(status ? { status } : {}),
    });
    const last = entries.at(-1);
    return {
      data: entries,
      next_cursor:
        hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
    };
  }

  getEntry(input: { organizationId: string; id: string }): Promise<AgentRegistryEntry> {
    return this.deps.registry.getEntry(input);
  }

  async listVersions({
    organizationId,
    id,
    cursor,
    limit,
  }: {
    organizationId: string;
    id: string;
    cursor?: string;
    limit: number;
  }): Promise<AgentRegistryEventPage> {
    await this.deps.registry.getEntry({ organizationId, id });
    const events = await this.deps.registry.findEventsOfEntry({
      organizationId,
      entryId: id,
      ...(cursor ? { after: BigInt(cursor) } : {}),
      limit,
    });
    return {
      data: events,
      next_cursor: events.length === limit ? (events.at(-1)?.sequence ?? null) : null,
    };
  }

  async listEvents({
    organizationId,
    cursor,
    limit,
  }: {
    organizationId: string;
    cursor?: string;
    limit: number;
  }): Promise<AgentRegistryEventPage> {
    const events = await this.deps.registry.findEventsAfter({
      organizationId,
      ...(cursor ? { after: BigInt(cursor) } : {}),
      limit,
    });
    return {
      data: events,
      next_cursor: events.length === limit ? (events.at(-1)?.sequence ?? null) : null,
    };
  }

  async ardManifest({ organizationId }: { organizationId: string }): Promise<ArdManifest> {
    const entries = await this.deps.registry.findEntries({
      organizationId,
      status: "active",
      limit: AGENT_REGISTRY_ARD_ENTRY_LIMIT,
    });
    const updatedAt =
      entries
        .map((entry) => entry.updated_at)
        .toSorted()
        .at(-1) ?? registryTimestamp(this.deps.now());
    return ardManifestOf({
      entries,
      publisher: ardPublisherOf(this.deps.publicBaseUrl),
      organizationId,
      updatedAt,
    });
  }

  async ardSearch({
    organizationId,
    request,
  }: {
    organizationId: string;
    request: ArdSearchRequest;
  }): Promise<ArdSearchResponse> {
    return ardSearch({ manifest: await this.ardManifest({ organizationId }), request });
  }

  private async reconcileLogged({ organizationId }: { organizationId: string }): Promise<void> {
    try {
      await this.reconcileOrganization({ organizationId });
    } catch (error) {
      this.deps.logger.warn(
        { organizationId, error },
        "agent registry reconcile failed for one organisation; the next trigger retries it",
      );
    }
  }

  private async draftsOf({ organizationId }: { organizationId: string }): Promise<RegistryDraft[]> {
    const projectIds = await this.deps.projects.findLiveNonGovernanceIdsByOrganization({
      organizationId,
    });
    const [agents, discovered, members, projects] = await Promise.all([
      this.agentsOf(projectIds),
      this.deps.discoveredAgents.findForRegistry({ organizationId }),
      this.deps.organizations.findMembersWithDepartments({ organizationId }),
      projectIds.length > 0
        ? this.deps.projects.listNamesByIds({ projectIds })
        : Promise.resolve([]),
    ]);
    const names = memberNames(members);
    const slugs = new Map(projects.map((project) => [project.id, project.slug]));
    const base = this.deps.publicBaseUrl;

    const listed: RegistryDraft[] = agents.map((agent) => {
      const slug = slugs.get(agent.projectId);
      return langwatchAgentDraft({
        agent,
        ownerName: agent.ownerUserId ? (names.get(agent.ownerUserId) ?? null) : null,
        publicBaseUrl: base,
        consoleUrl: slug
          ? this.deps.agents.platformUrl({
              projectSlug: slug,
              agentId: agent.id,
              agentType: agent.type,
            })
          : null,
      });
    });
    for (const row of discovered) {
      const source = AGENT_SOURCE_BY_PROVIDER.get(row.provider);
      if (source === "databricks" || source === "copilot_studio") {
        listed.push(discoveredAgentDraft({ ...row, source }));
      }
    }

    const since = this.deps.now().epochMilliseconds - REGISTRY_TRAFFIC_WINDOW_MS;
    const seen = await Promise.all(
      projectIds.map(async (projectId) => ({
        projectId,
        agents: await this.deps.traces.findAgentsSeen({
          projectId,
          sinceMs: since,
          limit: REGISTRY_TRAFFIC_LIMIT_PER_PROJECT,
        }),
      })),
    );
    return [...listed, ...trafficAgentDrafts({ seen, listed })];
  }

  private async agentsOf(projectIds: readonly string[]): Promise<Agent[]> {
    const agents: Agent[] = [];
    for (const projectId of projectIds) {
      let totalPages = 1;
      for (let page = 1; page <= totalPages; page++) {
        const result = await this.deps.agents.list({ projectId, page, limit: AGENTS_PAGE_LIMIT });
        agents.push(...result.data);
        totalPages = result.pagination.totalPages;
      }
    }
    return agents;
  }
}
