// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import {
  createTenantId,
  type Event,
  type EventSubscriberDefinition,
  type MapProjectionDefinition,
} from "@langwatch/eventing";
import {
  type GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  type RecordBudgetCrossingCommandData,
  type RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
  ORGANIZATION_AGGREGATE_TYPE,
  type OrganizationApi,
} from "@langwatch/organization-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  USER_AGGREGATE_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  type UserApi,
} from "@langwatch/user-contract";
import { vi } from "vitest";

import { HttpCustomerIoChannel } from "../../channels/http/http.customer-io.channel.ts";
import { MemoryNurturingErasedUserRepository } from "../../repositories/memory/memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingVirtualKeyRepository } from "../../repositories/memory/memory.nurturing-gateway-key.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingOrganizationPlanRepository } from "../../repositories/memory/memory.nurturing-organization-plan.repository.ts";
import { MemoryNurturingPersonalProjectRepository } from "../../repositories/memory/memory.nurturing-personal-project.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import {
  MemoryNurturingClaimRepository,
  MemoryNurturingRepositories,
} from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingClaimRepository } from "../../repositories/nurturing-claim.repository.ts";
import type { NurturingVirtualKeyFact } from "../../rules/nurturing-virtual-key.rules.ts";
import { NurturingDeliveryService } from "../../services/nurturing-delivery.service.ts";
import { NurturingGatewayFactsService } from "../../services/nurturing-gateway-facts.service.ts";
import { NurturingMemberFactsService } from "../../services/nurturing-member-facts.service.ts";
import { NurturingUserErasureService } from "../../services/nurturing-user-erasure.service.ts";
import { NurturingService } from "../../services/nurturing.service.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_VIRTUAL_KEYS_PROJECTION_NAME,
  nurturingMembershipSubscriber,
} from "../nurturing-project-usage.pipeline.ts";
import { buildNurturingPipeline } from "../nurturing.pipeline.ts";

export const ORGANIZATION_ID = "org-1";
export const ADMIN_USER_ID = "user-admin";

/** Gateway's created fact for vk_1, with its forbidden fields set so a leak would show. */
export function lifecycleFact(
  overrides: Partial<RecordVkLifecycleCommandData> = {},
): RecordVkLifecycleCommandData {
  return {
    tenantId: "project-1",
    organization_id: ORGANIZATION_ID,
    virtual_key_id: "vk_1",
    action: "created",
    name: "Jane's key",
    display_prefix: "vk-lw-01ABC",
    reason: null,
    actor_user_id: "user-creator",
    principal_user_id: "user-holder",
    purpose: "USER",
    occurred_at: 1_000,
    ...overrides,
  };
}

/** Gateway's threshold crossing of vk_1's own monthly budget. */
export function crossingFact(
  overrides: Partial<RecordBudgetCrossingCommandData> = {},
): RecordBudgetCrossingCommandData {
  return {
    tenantId: "project-1",
    organization_id: ORGANIZATION_ID,
    budget_id: "budget-hidden-1",
    kind: "threshold_crossed",
    scope_type: "virtual_key",
    bucket_scope_id: "vk_1",
    end_user_id: null,
    virtual_key_id: "vk_1",
    anchor_project_id: null,
    window: "MONTH",
    period_started_at_ms: 1_000_000,
    period_ends_at_ms: 2_000_000,
    limit_usd: "100.000000",
    spent_usd: "84.500000",
    on_breach: "warn",
    occurred_at: 5_000,
    ...overrides,
  };
}

/** One of gateway's governance facts as its pipeline appends it. */
export function gatewayEvent(
  fact:
    | { type: typeof GATEWAY_VK_LIFECYCLE_EVENT_TYPE; data: RecordVkLifecycleCommandData }
    | { type: typeof GATEWAY_BUDGET_CROSSING_EVENT_TYPE; data: RecordBudgetCrossingCommandData },
): Event {
  const subject =
    fact.type === GATEWAY_VK_LIFECYCLE_EVENT_TYPE
      ? `vk:${fact.data.virtual_key_id}:${fact.data.action}`
      : `budget:${fact.data.budget_id}:${fact.data.kind}`;
  return {
    id: `evt-${subject}-${fact.data.occurred_at}`,
    aggregateId: subject,
    aggregateType: "governance_subject",
    tenantId: createTenantId(fact.data.tenantId),
    createdAt: fact.data.occurred_at,
    occurredAt: fact.data.occurred_at,
    type: fact.type,
    version: "2026-07-31",
    data: fact.data,
    idempotencyKey: `${subject}:${fact.data.occurred_at}`,
  } as Event;
}

/** The usage pipeline's key lane as a worker registers it, whatever the sync flag. */
function registeredKeyLane({
  virtualKeys,
  members,
}: Readonly<{
  virtualKeys: MemoryNurturingVirtualKeyRepository;
  members: MemoryNurturingOrganizationMemberRepository;
}>): MapProjectionDefinition<NurturingVirtualKeyFact, Event> {
  const others = MemoryNurturingRepositories.create();
  const pipeline = buildNurturingProjectUsagePipeline({
    store: others.projectUsage,
    copies: {
      placements: others.placements,
      copyLanded: async () => undefined,
      organizationsCreated: others.organizationsCreated,
      members,
      virtualKeys,
    },
    sync: undefined,
  });
  let lane: MapProjectionDefinition<NurturingVirtualKeyFact, Event> | undefined;
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: () => undefined,
    registerPeerMapProjection: (map) => {
      const keys = `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_VIRTUAL_KEYS_PROJECTION_NAME}`;
      if (map.name === keys) lane = map as unknown as MapProjectionDefinition<NurturingVirtualKeyFact, Event>;
    },
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  if (!lane) throw new Error("the usage pipeline registers no key lane");
  return lane;
}

/** User's erasure fact for one account. */
export function userErasedEvent(userId: string): Event {
  return {
    id: `evt-erased-${userId}`,
    aggregateId: userId,
    aggregateType: USER_AGGREGATE_TYPE,
    tenantId: createTenantId(userId),
    createdAt: 9_000,
    occurredAt: 9_000,
    type: USER_ERASED_EVENT_TYPE,
    version: USER_LIFECYCLE_EVENT_VERSION,
    data: { tenantId: userId, userId, occurredAt: 9_000, organizationIds: [ORGANIZATION_ID] },
  } as Event;
}

/** Organization's fact that `userId` accepted an invitation into the organization at `at`. */
export function inviteAcceptedEvent(userId: string, at: number): Event {
  return {
    id: `evt-invite-accepted-${userId}-${at}`,
    aggregateId: ORGANIZATION_ID,
    aggregateType: ORGANIZATION_AGGREGATE_TYPE,
    tenantId: createTenantId(ORGANIZATION_ID),
    createdAt: at,
    occurredAt: at,
    type: INVITE_ACCEPTED_EVENT_TYPE,
    version: "2026-10-09",
    data: {
      tenantId: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
      userId,
      occurredAt: at,
      inviteId: `invite-${userId}`,
      organizationName: "Acme",
      role: "MEMBER",
    },
  } as Event;
}

/** Customer.io over a recording fetch: every request body, and each call it took. */
function recordingCustomerIo() {
  const requests: string[] = [];
  const sent: CioBatchCall[] = [];
  /** Call types Customer.io refuses until the test lets them through. */
  const refusing = new Set<CioBatchCall["type"]>();
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push(body);
    const { batch } = JSON.parse(body) as { batch: CioBatchCall[] };
    if (batch.some(({ type }) => refusing.has(type))) return new Response(null, { status: 500 });
    sent.push(...batch);
    return new Response(null, { status: 200 });
  });
  const service = NurturingService.create({
    channel: HttpCustomerIoChannel.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn,
      errorReporter: { capture: () => {} },
    }),
  });
  return { service, requests, sent, refusing };
}

/**
 * Nurturing as the app composes it for gateway's facts, over its own memory copies and a
 * recording Customer.io: the key copy's and member copy's subscribers, then every nurturing peer
 * lane on the type.
 * `user-admin` is the organization's copied admin and a current member; `claims` may be
 * Redis-backed.
 */
export async function gatewayFactsOver({
  claims = MemoryNurturingClaimRepository.create(),
}: Readonly<{ claims?: NurturingClaimRepository }> = {}) {
  const customerIo = recordingCustomerIo();
  // One mark set for every copy and send, as the app composes them.
  const erasedUsers = MemoryNurturingErasedUserRepository.create();
  const virtualKeys = MemoryNurturingVirtualKeyRepository.create({ erasedUsers });
  const members = MemoryNurturingOrganizationMemberRepository.create({ erasedUsers });
  const milestones = MemoryNurturingMilestonesRepository.create({ erasedUsers });
  await milestones.recordOrganization({
    organizationId: ORGANIZATION_ID,
    adminUserId: ADMIN_USER_ID,
    seeded: false,
  });
  // The admin hears a key only as a current member, so the copy holds their membership.
  await members.recordMembershipChange({
    organizationId: ORGANIZATION_ID,
    userId: ADMIN_USER_ID,
    change: "joined",
    at: 1,
  });
  const memberFacts = NurturingMemberFactsService.create({
    claims,
    milestones,
    projects: MemoryNurturingProjectDirectoryRepository.create(),
    organizations: createApiFixture<OrganizationApi>({}),
  });
  const delivery = NurturingDeliveryService.create({
    erasedUsers,
    claims,
    customerIo: customerIo.service,
    posthog: undefined,
    users: createApiFixture<UserApi>({}),
    memberFacts,
    members,
    plans: MemoryNurturingOrganizationPlanRepository.create(),
  });
  const { logger, lines } = createTestLogger();
  const gatewayFacts = NurturingGatewayFactsService.create({
    keys: virtualKeys,
    erasedUsers,
    members,
    admins: memberFacts,
    logger,
  });
  const userErasure = NurturingUserErasureService.create({
    personalProjects: MemoryNurturingPersonalProjectRepository.create(),
    organizations: milestones,
    members,
    virtualKeys,
  });
  const pipeline = buildNurturingPipeline({
    deliver: (input) => delivery.deliver(input),
    projectCreated: async () => undefined,
    guidedTurnFailed: async () => undefined,
    usageReportReceived: async () => undefined,
    evaluationsCompleted: async () => undefined,
    simulationRunsFinished: async () => undefined,
    codingSessionsStored: async () => undefined,
    recordPersonalOwner: async () => undefined,
    recordTracedProject: async () => undefined,
    forgetErasedUser: (input) => userErasure.forgetUser(input),
    virtualKeyCreated: (input) => gatewayFacts.virtualKeyCreated(input),
    keyBudgetCrossed: (input) => gatewayFacts.keyBudgetCrossed(input),
  });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  // The key copy as the usage pipeline registers it: the live lane's parse, then its store.
  const keyLane = registeredKeyLane({ virtualKeys, members });
  const memberCopy = nurturingMembershipSubscriber({
    eventType: INVITE_ACCEPTED_EVENT_TYPE,
    data: inviteAcceptedEventDataSchema,
    change: "joined",
    members,
  });

  /** Copies a lifecycle or join fact, then hands the event to every nurturing peer lane on it. */
  const deliverFact = async (event: Event) => {
    if (event.type === INVITE_ACCEPTED_EVENT_TYPE) {
      if (!memberCopy.handle) throw new Error("the member copy handles one fact at a time");
      await memberCopy.handle(inviteAcceptedEventDataSchema.parse(event.data), {
        tenantId: event.tenantId,
        aggregateId: event.aggregateId,
        createdAt: event.createdAt,
        occurredAt: event.occurredAt,
        eventId: event.id,
      });
    }
    if (event.type === GATEWAY_VK_LIFECYCLE_EVENT_TYPE) {
      const fact = keyLane.map(event);
      if (fact) {
        await keyLane.store.append(fact, {
          tenantId: event.tenantId,
          aggregateId: event.aggregateId,
        });
      }
    }
    const lanes = subscribers.filter(({ eventTypes }) => eventTypes.includes(event.type));
    for (const lane of lanes) {
      await lane.handle(event, { tenantId: event.tenantId, aggregateId: event.aggregateId });
    }
  };
  /** A current member of the organization since `at`, as an owner's join fact records one. */
  async function joined(userId: string, at = 1): Promise<void> {
    await members.recordMembershipChange({
      organizationId: ORGANIZATION_ID,
      userId,
      change: "joined",
      at,
    });
  }
  /** A member disabled at `at`: the copy keeps the row, so the person is no current member. */
  async function disabled(userId: string, at = 2): Promise<void> {
    await members.recordMembershipChange({
      organizationId: ORGANIZATION_ID,
      userId,
      change: "left",
      at,
    });
  }

  return {
    deliverFact,
    joined,
    disabled,
    virtualKeys,
    members,
    milestones,
    erasedUsers,
    logLines: lines,
    requests: customerIo.requests,
    sent: customerIo.sent,
    refusing: customerIo.refusing,
  };
}
