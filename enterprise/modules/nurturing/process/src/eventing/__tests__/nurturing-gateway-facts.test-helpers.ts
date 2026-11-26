// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import {
  createTenantId,
  type Event,
  type EventSubscriberDefinition,
  type MapProjectionDefinition,
} from "@langwatch/eventing";
import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
  type GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  type RecordBudgetCrossingCommandData,
  type RecordUnbudgetedSpendCommandData,
  type RecordVkFirstRequestCommandData,
  type RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
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
import { MemoryNurturingPersonalProjectRepository } from "../../repositories/memory/memory.nurturing-personal-project.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import {
  MemoryNurturingClaimRepository,
  MemoryNurturingRepositories,
} from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingClaimRepository } from "../../repositories/nurturing-claim.repository.ts";
import { peopleWithEmails } from "../../services/__tests__/nurturing-person-email.test-helpers.ts";
import { NurturingDeliveryService } from "../../services/nurturing-delivery.service.ts";
import { NurturingGatewayFactsService } from "../../services/nurturing-gateway-facts.service.ts";
import { NurturingGovernanceFactsService } from "../../services/nurturing-governance-facts.service.ts";
import { NurturingMemberFactsService } from "../../services/nurturing-member-facts.service.ts";
import { NurturingUserErasureService } from "../../services/nurturing-user-erasure.service.ts";
import { NurturingService } from "../../services/nurturing.service.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_VIRTUAL_KEYS_PROJECTION_NAME,
} from "../nurturing-project-usage.pipeline.ts";
import { buildNurturingPipeline, type NurturingPipeline } from "../nurturing.pipeline.ts";

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

/** Gateway's fact that vk_1 served its first request. */
export function firstRequestFact(
  overrides: Partial<RecordVkFirstRequestCommandData> = {},
): RecordVkFirstRequestCommandData {
  return {
    tenantId: "project-1",
    organization_id: ORGANIZATION_ID,
    virtual_key_id: "vk_1",
    occurred_at: 3_000,
    ...overrides,
  };
}

/** Gateway's fact that org-1's person keys spent without a budget in ISO week 2026-W48. */
export function unbudgetedSpendFact(
  overrides: Partial<RecordUnbudgetedSpendCommandData> = {},
): RecordUnbudgetedSpendCommandData {
  return {
    tenantId: "project-1",
    organization_id: ORGANIZATION_ID,
    iso_week: "2026-W48",
    keys: [
      { virtual_key_id: "vk_1", name: "Support bot key", spent_usd: "42.5" },
      { virtual_key_id: "vk_2", name: "CI key", spent_usd: "7" },
    ],
    key_count: 2,
    total_spent_usd: "49.5",
    occurred_at: 6_000,
    ...overrides,
  };
}

type GatewayFact =
  | { type: typeof GATEWAY_VK_LIFECYCLE_EVENT_TYPE; data: RecordVkLifecycleCommandData }
  | { type: typeof GATEWAY_BUDGET_CROSSING_EVENT_TYPE; data: RecordBudgetCrossingCommandData }
  | { type: typeof GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE; data: RecordVkFirstRequestCommandData }
  | { type: typeof GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE; data: RecordUnbudgetedSpendCommandData };

/** The fact's subject and what happened to it: one event id per distinct fact. */
function subjectOf(fact: GatewayFact): string {
  if (fact.type === GATEWAY_VK_LIFECYCLE_EVENT_TYPE) {
    return `vk:${fact.data.virtual_key_id}:${fact.data.action}`;
  }
  if (fact.type === GATEWAY_BUDGET_CROSSING_EVENT_TYPE) {
    return `budget:${fact.data.budget_id}:${fact.data.kind}`;
  }
  if (fact.type === GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE) {
    return `org:${fact.data.organization_id}:${fact.data.iso_week}`;
  }
  return `vk:${fact.data.virtual_key_id}:first_request`;
}

/** One of gateway's governance facts as its pipeline appends it. */
export function gatewayEvent(fact: GatewayFact): Event {
  const subject = subjectOf(fact);
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

/**
 * The usage pipeline's key and member lanes as a worker registers them, whatever the sync flag:
 * each live lane's parse of an event, then its store. Takes each lane at the registry's own
 * generic, so no record or event type is asserted.
 */
function registeredCopyLanes({
  virtualKeys,
  members,
}: Readonly<{
  virtualKeys: MemoryNurturingVirtualKeyRepository;
  members: MemoryNurturingOrganizationMemberRepository;
}>): (event: Event) => Promise<void> {
  const others = MemoryNurturingRepositories.create();
  const pipeline = buildNurturingProjectUsagePipeline({
    store: others.projectUsage,
    evaluationDays: others.evaluationDays,
    traceDays: others.traceDays,
    copies: {
      placements: others.placements,
      organizationsCreated: others.organizationsCreated,
      admins: others.milestones,
      members,
      virtualKeys,
      personalProjects: others.personalProjects,
      tracedProjects: others.tracedProjects,
      lastTraces: others.milestones,
    },
    plans: { store: others.plans, deliver: async () => undefined },
    sync: undefined,
  });
  const copyLanes = new Set(
    [NURTURING_VIRTUAL_KEYS_PROJECTION_NAME, NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME].map(
      (name) => `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${name}`,
    ),
  );
  const applies: ((event: Event) => Promise<void>)[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: () => undefined,
    // The plan fold and its send register too; this lane reads only the key map.
    registerPeerFoldProjection: () => undefined,
    registerSubscriber: () => undefined,
    registerPeerMapProjection: <MapRecord, Own extends Event>(
      map: MapProjectionDefinition<MapRecord, Own>,
    ) => {
      if (!copyLanes.has(map.name)) return;
      // The router hands a lane only the event types it declares; narrowing by them is that contract.
      const isOwn = (event: Event): event is Own => map.eventTypes.includes(event.type);
      applies.push(async (event) => {
        if (!isOwn(event)) return;
        const record = map.map(event);
        if (record === null) return;
        await map.store.append(record, {
          tenantId: event.tenantId,
          aggregateId: event.aggregateId,
        });
      });
    },
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  if (applies.length !== copyLanes.size) throw new Error("the usage pipeline lacks a copy lane");
  return async (event) => {
    for (const apply of applies) await apply(event);
  };
}

/** The queue's delivery of a job: its 1-based attempt, absent outside the queue. */
type Delivery = Readonly<{ deliveryAttempt?: number }>;

/**
 * The nurturing pipeline's peer subscribers as a worker registers them, and the live router's
 * hand-off: an owner's event goes to every subscriber declaring its type, in registration order.
 */
export function liveSubscribersOf(
  pipeline: NurturingPipeline,
): (event: Event, delivery?: Delivery) => Promise<void> {
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<NurturingPipeline["globalProjections"]>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  return async (event, delivery = {}) => {
    const lanes = subscribers.filter(({ eventTypes }) => eventTypes.includes(event.type));
    for (const lane of lanes) {
      await lane.handle(event, {
        tenantId: event.tenantId,
        aggregateId: event.aggregateId,
        ...delivery,
      });
    }
  };
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

/**
 * The email-only identify NurturingService puts before a lone track, so its profile is born with
 * an address: covered in its own tests, and left out of `sent` so a fact's calls read plainly.
 */
const isEmailOnlyIdentify = (call: CioBatchCall) =>
  call.type === "identify" && Object.keys(call.traits).join() === "email";

/** Customer.io over a recording fetch: every request body, and each fact call it took. */
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
    sent.push(...batch.filter((call) => !isEmailOnlyIdentify(call)));
    return new Response(null, { status: 200 });
  });
  const service = NurturingService.create({
    users: peopleWithEmails(),
    channel: HttpCustomerIoChannel.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn,
      errorReporter: { capture: () => {} },
    }),
  });
  return { service, requests, sent, refusing };
}

/**
 * Nurturing as the app composes it for gateway's and governance's facts, over its own memory
 * copies and a recording Customer.io: the key copy's and member copy's subscribers, then every
 * nurturing peer lane on the type.
 * `user-admin` is the organization's copied admin and a current member; `claims` may be
 * Redis-backed, and `organizationId` (org-1 by default) unique to a run that shares them.
 */
export async function gatewayFactsOver({
  claims = MemoryNurturingClaimRepository.create(),
  organizationId = ORGANIZATION_ID,
}: Readonly<{ claims?: NurturingClaimRepository; organizationId?: string }> = {}) {
  const customerIo = recordingCustomerIo();
  // One mark set for every copy and send, as the app composes them.
  const erasedUsers = MemoryNurturingErasedUserRepository.create();
  const virtualKeys = MemoryNurturingVirtualKeyRepository.create({ erasedUsers });
  const members = MemoryNurturingOrganizationMemberRepository.create({ erasedUsers });
  const milestones = MemoryNurturingMilestonesRepository.create({ erasedUsers });
  await milestones.recordOrganization({
    organizationId,
    adminUserId: ADMIN_USER_ID,
    seeded: false,
  });
  // The admin hears a key only as a current member, so the copy holds their membership.
  await members.recordMembershipChange({
    organizationId,
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
  });
  const { logger, lines } = createTestLogger();
  const gatewayFacts = NurturingGatewayFactsService.create({
    keys: virtualKeys,
    erasedUsers,
    members,
    admins: memberFacts,
    logger,
  });
  const governanceFacts = NurturingGovernanceFactsService.create({
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
    organizationMembers: async () => [],
    guidedTurnFailed: async () => undefined,
    usageReportReceived: async () => undefined,
    evaluationsCompleted: async () => undefined,
    simulationRunsFinished: async () => undefined,
    codingSessionsStored: async () => undefined,
    forgetErasedUser: (input) => userErasure.forgetUser(input),
    virtualKeyCreated: (input) => gatewayFacts.virtualKeyCreated(input),
    keyBudgetCrossed: (input) => gatewayFacts.keyBudgetCrossed(input),
    keyFirstRequested: (input) => gatewayFacts.keyFirstRequested(input),
    unbudgetedSpendRecorded: (input) => gatewayFacts.unbudgetedSpendRecorded(input),
    governanceSourceConnected: (input) => governanceFacts.sourceConnected(input),
    governanceSourceLive: (input) => governanceFacts.sourceWentLive(input),
  });
  const toSubscribers = liveSubscribersOf(pipeline);
  // The key and member copies as the usage pipeline registers them: parse, then store.
  const copyLanes = registeredCopyLanes({ virtualKeys, members });

  /**
   * Copies a lifecycle or join fact, then hands the event to every nurturing peer lane on it, as
   * the queue's `deliveryAttempt` when given.
   */
  const deliverFact = async (event: Event, delivery?: Delivery) => {
    await copyLanes(event);
    await toSubscribers(event, delivery);
  };
  /** A current member of the organization since `at`, as an owner's join fact records one. */
  async function joined(userId: string, at = 1): Promise<void> {
    await members.recordMembershipChange({
      organizationId,
      userId,
      change: "joined",
      at,
    });
  }
  /** A member disabled at `at`: the copy keeps the row, so the person is no current member. */
  async function disabled(userId: string, at = 2): Promise<void> {
    await members.recordMembershipChange({
      organizationId,
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
