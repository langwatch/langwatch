// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { generate } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import { eventMatches, type WebhookApi } from "@langwatch/webhook-contract";

import type { AgentRegistryRepository } from "../../../repositories/agent-registry.repository.ts";
import type { AgentRegistryDeliveryIntent } from "../eventing/agent-registry-delivery.process.ts";
import { changedSince, planRegistryChanges } from "../rules/registry-reconcile.rules.ts";
import {
  AgentRegistrySourcesService,
  type AgentRegistrySourcesDependencies,
} from "./agent-registry-sources.service.ts";

/** Where the registry records its webhook fan-out; governance's outbox in the worker. */
export interface AgentRegistryDeliveryOutbox {
  record(intents: readonly AgentRegistryDeliveryIntent[]): Promise<void>;
}

const FAN_OUT_BATCH = 500;
/** A read another reconcile overtook is read again; past this the newer commit stands. */
const RECONCILE_ATTEMPTS = 3;
const ORGANIZATION_PAGE_LIMIT = 100;

/** One scheduled traffic pass, as the traffic process asks it. */
export type AgentRegistryTrafficPass = {
  everyOrganization?: boolean;
  after?: string;
  onPage?: (page: WalkPage) => Promise<void>;
  signal?: AbortSignal;
};

/** A walk's progress after one page: its last organisation and how many this call reconciled. */
export type WalkPage = { afterOrganizationId: string; organizations: number };

type AgentRegistryDependencies = {
  registry: AgentRegistryRepository;
  sources: AgentRegistrySourcesService;
  organizations: Pick<OrganizationApi, "listAllIds">;
  webhooks: Pick<WebhookApi, "getAll">;
  /** The registry is an Enterprise feature: an organisation without the plan is never reconciled. */
  entitlements: { hasEnterprisePlan: (organizationId: string) => Promise<boolean> };
  /** Present in the worker, where the delivery process runs; the api records no fan-out. */
  outbox: () => AgentRegistryDeliveryOutbox | undefined;
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
  }: Omit<AgentRegistryDependencies, "sources" | "organizations" | "logger" | "now" | "newId"> &
    Omit<AgentRegistrySourcesDependencies, "organizations" | "now"> & {
      organizations: Pick<OrganizationApi, "findMembersWithDepartments" | "listAllIds">;
      logger?: Logger;
      now?: () => Instant;
      newId?: () => string;
    }): AgentRegistryService {
    const { discoveredAgents, agents, projects, traces, publicBaseUrl, ...own } = deps;
    const sources = AgentRegistrySourcesService.create({
      discoveredAgents,
      agents,
      projects,
      traces,
      organizations: own.organizations,
      publicBaseUrl,
      now,
    });
    return new AgentRegistryService({ ...own, sources, logger, now, newId });
  }

  /**
   * Rebuilds the organisation's entries from its sources, appends what changed, fans it out. A
   * read another reconcile's commit overtook plans nothing and is read again. An organisation's
   * first reconcile is its silent baseline: its events stay in the feed but are pushed to no
   * webhook. An organisation without the Enterprise plan is left untouched.
   */
  async reconcileOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ events: number }> {
    if (!(await this.deps.entitlements.hasEnterprisePlan(organizationId))) return { events: 0 };
    let events = 0;
    for (let attempt = 1; attempt <= RECONCILE_ATTEMPTS; attempt++) {
      const readAt = this.deps.now();
      const { drafts, keep } = await this.deps.sources.read({ organizationId });
      const now = this.deps.now();
      let superseded = false;
      const appended = await this.deps.registry.applyChanges({
        organizationId,
        plan: (stored) => {
          superseded = changedSince({ stored, readAt });
          return planRegistryChanges({ stored, drafts, now, newId: this.deps.newId, readAt, keep });
        },
        baselineAt: now,
      });
      events += appended.length;
      if (!superseded) break;
    }
    await this.fanOutPending({ organizationId });
    return { events };
  }

  /**
   * The scheduled traffic pass: every organisation the registry holds, or, with
   * `everyOrganization`, a walk over every organisation from `after`, so one whose first agent
   * shows only in traces is reached too. `complete` is false when the walk was cut short.
   */
  async reconcileTraffic({
    everyOrganization = false,
    after,
    onPage,
    signal,
  }: AgentRegistryTrafficPass = {}): Promise<{ organizations: number; complete: boolean }> {
    if (everyOrganization) {
      const { organizations, complete } = await this.seedAll({
        ...(after === undefined ? {} : { after }),
        ...(onPage ? { onPage } : {}),
        ...(signal ? { signal } : {}),
      });
      return { organizations, complete };
    }
    let organizations = 0;
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore && !signal?.aborted) {
      const ids = await this.deps.registry.findOrganizationIds({
        after: cursor,
        limit: ORGANIZATION_PAGE_LIMIT,
      });
      for (const organizationId of ids) {
        await this.reconcileLogged({ organizationId });
        organizations += 1;
      }
      hasMore = ids.length === ORGANIZATION_PAGE_LIMIT;
      cursor = ids.at(-1);
    }
    return { organizations, complete: !hasMore };
  }

  /**
   * Every organisation, once: the deploy step that fills the registry and the daily walk. Each
   * organisation's first reconcile is its baseline, so no burst for agents that already existed.
   */
  async seedAll({
    after,
    signal,
    onPage,
  }: {
    after?: string;
    signal?: AbortSignal;
    onPage?: (page: WalkPage) => Promise<void>;
  }): Promise<{ afterOrganizationId: string | null; organizations: number; complete: boolean }> {
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
        await onPage?.({ afterOrganizationId: last, organizations });
      }
      hasMore = page.next !== null;
    }
    return { afterOrganizationId: cursor ?? null, organizations, complete: !hasMore };
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
}
