// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's plan copy as a peer fold over billing's subscription_changed facts, and its send:
 * live delivery through the eventing runtime, the send's own retries, and the deploy replay over a
 * seeded billing log, which fills the copy and sends nothing.
 * Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import {
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_EVENT_VERSION,
  BILLING_LIFECYCLE_PIPELINE_NAME,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  subscriptionChangedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import {
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
} from "@langwatch/evaluation-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSourcing,
  type ReplayEvent,
  ReplayService,
  projectionLaneReplayer,
  replayProjectionsOf,
  sealPipelineDefinition,
} from "@langwatch/eventing";
import {
  EventStoreMemory,
  testEventSchema,
  IDLE_REPLAY_CLAIMS_INDEX,
} from "@langwatch/eventing/testing";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { HttpCustomerIoChannel } from "../../channels/http/http.customer-io.channel.ts";
import { MemoryNurturingErasedUserRepository } from "../../repositories/memory/memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationPlanRepository } from "../../repositories/memory/memory.nurturing-organization-plan.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import {
  MemoryNurturingClaimRepository,
  MemoryNurturingRepositories,
} from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingPlanFoldState } from "../../rules/nurturing-organization-plan.rules.ts";
import { memberCopyOf } from "../../services/__tests__/nurturing-member-facts.test-helpers.ts";
import { peopleWithEmails } from "../../services/__tests__/nurturing-person-email.test-helpers.ts";
import { NurturingDeliveryService } from "../../services/nurturing-delivery.service.ts";
import { NurturingMemberFactsService } from "../../services/nurturing-member-facts.service.ts";
import { NoCustomerIoChannelError } from "../../services/nurturing-plan-sync.service.ts";
import { NurturingService } from "../../services/nurturing.service.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_ORGANIZATION_PLANS_PROJECTION_NAME,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  type NurturingPlanCopy,
  nurturingOrganizationPlanFold,
  nurturingPlanSyncSubscriber,
} from "../nurturing-project-usage.pipeline.ts";
import { allNurturingOwnerStandIns } from "./nurturing-owner-stand-ins.test-helpers.ts";
import { nurturingReplayStepsOver, PLANS_STEP } from "./nurturing-replay-steps.test-helpers.ts";
import { NurturingSeededLog } from "./nurturing-seeded-log.test-helpers.ts";

const ORGANIZATION_ID = "org-1";
const LANE = `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_ORGANIZATION_PLANS_PROJECTION_NAME}`;
const BASE_MS = Date.UTC(2026, 10, 1);
const tenantId = createTenantId(ORGANIZATION_ID);
const storeContext = { aggregateId: ORGANIZATION_ID, tenantId };

const subscriptionChangedSchema = testEventSchema(
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  subscriptionChangedEventDataSchema,
);
type SubscriptionChanged = z.infer<typeof subscriptionChangedSchema>;

let sequence = 0;
/** Billing's fact for the organization, stamped `at`, keyed by the organization as billing does. */
function subscriptionChanged({
  plan,
  at,
  fromCatchUp,
}: Readonly<{ plan: string; at: number; fromCatchUp?: boolean }>): SubscriptionChanged {
  const n = ++sequence;
  return {
    id: `billing-${n}`,
    aggregateId: ORGANIZATION_ID,
    aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
    tenantId,
    createdAt: BASE_MS + n,
    occurredAt: at,
    type: SUBSCRIPTION_CHANGED_EVENT_TYPE,
    version: BILLING_LIFECYCLE_EVENT_VERSION,
    idempotencyKey: `billing-${n}`,
    data: {
      tenantId: ORGANIZATION_ID,
      occurredAt: at,
      organizationId: ORGANIZATION_ID,
      memberUserIds: ["user-1"],
      hasSubscription: plan !== "FREE",
      plan,
      ...(fromCatchUp === undefined ? {} : { fromCatchUp }),
    },
  };
}

/** The same fact as billing's log holds it, for the replay engine. */
const logged = (event: SubscriptionChanged): ReplayEvent => ({
  ...event,
  tenantId: String(event.tenantId),
  timestamp: event.createdAt,
  idempotencyKey: event.idempotencyKey ?? event.id,
});

const billingOwner = () =>
  definePipeline({
    name: BILLING_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: BILLING_LIFECYCLE_AGGREGATE_TYPE }),
  })
    .withEvents([subscriptionChangedSchema])
    .build();

/**
 * Nurturing's real delivery over a recording Customer.io: org-1's admin is admin-1, user-1 its
 * member. `customerIo: false` is a deployment that names no Customer.io key.
 */
async function recordingDelivery({ customerIo = true }: { customerIo?: boolean } = {}) {
  const sent: CioBatchCall[][] = [];
  const service = NurturingService.create({
    users: peopleWithEmails(),
    channel: HttpCustomerIoChannel.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn: async (_url: string | URL | Request, init?: RequestInit) => {
        const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        sent.push((body as { batch: CioBatchCall[] }).batch);
        return new Response(null, { status: 200 });
      },
      errorReporter: { capture: () => {} },
    }),
  });
  const claims = MemoryNurturingClaimRepository.create();
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({
    organizationId: ORGANIZATION_ID,
    adminUserId: "admin-1",
    seeded: false,
  });
  const delivery = NurturingDeliveryService.create({
    erasedUsers: MemoryNurturingErasedUserRepository.create(),
    claims,
    customerIo: customerIo ? service : undefined,
    posthog: undefined,
    users: createApiFixture<UserApi>({}),
    memberFacts: NurturingMemberFactsService.create({
      claims,
      milestones,
      projects: MemoryNurturingProjectDirectoryRepository.create(),
      organizations: createApiFixture<OrganizationApi>({}),
    }),
    members: await memberCopyOf({ organizationId: ORGANIZATION_ID, userIds: ["user-1"] }),
  });
  const deliver: NurturingPlanCopy["deliver"] = vi.fn((input) => delivery.deliver(input));
  /** The plan each group call told the admin, in order. */
  const groupPlans = () =>
    sent
      .flat()
      .filter((call) => call.type === "group")
      .map((call) => ("traits" in call ? call.traits?.plan : undefined));
  return { deliver, sent, groupPlans };
}

/** A worker of this release: billing's pipeline as a stand-in, the plan fold and its send. */
function liveWorker({
  deliver,
  store = MemoryNurturingOrganizationPlanRepository.create(),
}: {
  deliver: NurturingPlanCopy["deliver"];
  store?: MemoryNurturingOrganizationPlanRepository;
}) {
  const eventSourcing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
  const billing = eventSourcing.register(billingOwner());
  eventSourcing.register(
    definePipeline({
      name: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
      aggregate: defineAggregate({ type: "nurturing_project_usage_view" }),
    })
      .withEvents([])
      .withPeerFoldProjection(nurturingOrganizationPlanFold(store), [
        nurturingPlanSyncSubscriber({ store, deliver }),
      ])
      .build(),
  );
  eventSourcing.startConsumers();
  const folds = vi.spyOn(store, "store");
  /** Records the fact in billing's log and waits for the fold to commit it, one at a time. */
  const record = async (event: SubscriptionChanged) => {
    const committed = folds.mock.calls.length;
    await billing.service.storeEvents([event], { tenantId: event.tenantId });
    await vi.waitFor(() => expect(folds.mock.calls.length).toBeGreaterThan(committed));
  };
  /** Delivers the fold's job for `event` again, as an at-least-once queue may. */
  const redeliver = (event: SubscriptionChanged) =>
    eventSourcing.globalQueue?.send({
      ...event,
      __pipelineName: "global",
      __jobType: "projection",
      __jobName: LANE,
    });
  return { eventSourcing, store, record, redeliver };
}

const held = async (store: MemoryNurturingOrganizationPlanRepository) => {
  const read = await store.get(ORGANIZATION_ID);
  return read.kind === "folded" ? read.state : null;
};

describe("given billing's subscription facts delivered live", () => {
  /** @scenario "The plan fold sends only the fact that won it" */
  it("sends a newer fact exactly once, and an older one not at all", async () => {
    const cio = await recordingDelivery();
    const worker = liveWorker({ deliver: cio.deliver });
    const first = subscriptionChanged({ plan: "LAUNCH", at: 1_000 });
    const newer = subscriptionChanged({ plan: "GROWTH", at: 2_000 });
    const older = subscriptionChanged({ plan: "FREE", at: 1_500 });

    await worker.record(first);
    await vi.waitFor(() => expect(cio.groupPlans()).toEqual(["launch"]));
    await worker.record(newer);
    await vi.waitFor(() => expect(cio.groupPlans()).toEqual(["launch", "growth"]));
    await worker.record(older);

    expect(cio.groupPlans()).toEqual(["launch", "growth"]);
    await expect(held(worker.store)).resolves.toMatchObject({
      held: { outcome: "held", fact: { plan: "GROWTH", occurredAt: 2_000 } },
      winnerEventId: newer.id,
    });
    await worker.eventSourcing.close();
  });

  /** @scenario "The plan fold sends only the fact that won it" */
  it("sends nothing more when the winning fact is delivered again, its send claimed", async () => {
    const cio = await recordingDelivery();
    const worker = liveWorker({ deliver: cio.deliver });
    const fact = subscriptionChanged({ plan: "LAUNCH", at: 1_000 });
    await worker.record(fact);
    await vi.waitFor(() => expect(cio.groupPlans()).toEqual(["launch"]));

    await worker.redeliver(fact);

    await vi.waitFor(() => expect(cio.deliver).toHaveBeenCalledTimes(2));
    expect(cio.groupPlans()).toEqual(["launch"]);
    await worker.eventSourcing.close();
  });
});

describe("the plan fold's send", () => {
  const won = (event: SubscriptionChanged): NurturingPlanFoldState => ({
    held: {
      outcome: "held",
      fact: {
        plan: event.data.plan ?? null,
        occurredAt: event.data.occurredAt,
        fromCatchUp: event.data.fromCatchUp ?? false,
      },
    },
    winnerEventId: event.id,
    LastEventOccurredAt: event.data.occurredAt,
  });
  /** The copy as the fold committed it for `event`, and the send's job for it. */
  const committed = async (event: SubscriptionChanged, state: NurturingPlanFoldState) => {
    const store = MemoryNurturingOrganizationPlanRepository.create();
    await store.store(state, { ...storeContext, appliedEventIds: [event.id] });
    return store;
  };
  const jobContext = (state: NurturingPlanFoldState) => ({
    tenantId: ORGANIZATION_ID,
    aggregateId: ORGANIZATION_ID,
    state,
  });

  /** @scenario "The plan fold sends only the fact that won it" */
  it("mints no job for a fact that did not win the fold", () => {
    const winner = subscriptionChanged({ plan: "GROWTH", at: 2_000 });
    const loser = subscriptionChanged({ plan: "FREE", at: 1_000 });
    const send = nurturingPlanSyncSubscriber({
      store: MemoryNurturingOrganizationPlanRepository.create(),
      deliver: vi.fn(),
    });

    expect(send.when?.(loser, jobContext(won(winner)))).toBe(false);
    expect(send.when?.(winner, jobContext(won(winner)))).toBe(true);
  });

  /** @scenario "A catch-up fact with no Customer.io channel fails visibly" */
  it("fails its job with no_customer_io_channel for a catch-up on a deployment with no key", async () => {
    const catchUp = subscriptionChanged({ plan: "LAUNCH", at: 1_000, fromCatchUp: true });
    const keyless = await recordingDelivery({ customerIo: false });
    const send = nurturingPlanSyncSubscriber({
      store: await committed(catchUp, won(catchUp)),
      deliver: keyless.deliver,
    });

    const failed = send.handler(catchUp, jobContext(won(catchUp)));

    await expect(failed).rejects.toBeInstanceOf(NoCustomerIoChannelError);
    await expect(failed).rejects.toMatchObject({ code: "no_customer_io_channel" });
  });

  /** @scenario "A refused plan send retries its own job" */
  it("fails its own job when Customer.io refuses, and sends on the retry", async () => {
    const fact = subscriptionChanged({ plan: "GROWTH", at: 2_000 });
    let refusing = true;
    const delivered: string[] = [];
    const send = nurturingPlanSyncSubscriber({
      store: await committed(fact, won(fact)),
      deliver: async ({ signal }) => {
        if (refusing) throw new Error("Customer.io refused");
        delivered.push(signal.kind);
      },
    });

    await expect(send.handler(fact, jobContext(won(fact)))).rejects.toThrow("Customer.io refused");
    refusing = false;
    await send.handler(fact, jobContext(won(fact)));

    expect(delivered).toEqual(["subscription_changed"]);
  });

  /** @scenario "A refused plan send retries its own job" */
  it("sends nothing on a retry once a newer fact has won the copy", async () => {
    const refused = subscriptionChanged({ plan: "LAUNCH", at: 1_000, fromCatchUp: true });
    const newer = subscriptionChanged({ plan: "GROWTH", at: 2_000 });
    const deliver = vi.fn(async () => undefined);
    const send = nurturingPlanSyncSubscriber({
      store: await committed(newer, won(newer)),
      deliver,
    });

    await send.handler(refused, jobContext(won(refused)));

    expect(deliver).not.toHaveBeenCalled();
  });
});

/** A worker's deploy over billing's seeded log: the module's own steps, a counting send. */
function deploy(events: ReplayEvent[]) {
  const repositories = MemoryNurturingRepositories.create();
  const deliver = vi.fn(async () => undefined);
  const sync = {
    usageChanged: vi.fn(async () => undefined),
    tracesChanged: vi.fn(async () => undefined),
    organizationCreated: vi.fn(async () => undefined),
  };
  const pipeline = buildNurturingProjectUsagePipeline({
    store: repositories.projectUsage,
    evaluationDays: repositories.evaluationDays,
    traceDays: repositories.traceDays,
    copies: {
      placements: repositories.placements,
      organizationsCreated: repositories.organizationsCreated,
      admins: repositories.milestones,
      members: repositories.members,
      virtualKeys: repositories.virtualKeys,
      personalProjects: repositories.personalProjects,
      tracedProjects: repositories.tracedProjects,
      lastTraces: repositories.milestones,
    },
    plans: { store: repositories.plans, deliver },
    sync,
  });
  const replayer = projectionLaneReplayer({
    service: new ReplayService({
      claims: IDLE_REPLAY_CLAIMS_INDEX,
      eventSource: new NurturingSeededLog(events),
      redis: memoryRedisDouble({
        script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
      }),
    }),
    projections: replayProjectionsOf([
      ...allNurturingOwnerStandIns(),
      sealPipelineDefinition(pipeline),
    ]),
  });
  const steps = nurturingReplayStepsOver(replayer);
  const runStep = (id: string) => {
    const step = steps.find((each) => each.id === id);
    if (!step) throw new Error(`no step ${id}`);
    return step.run({
      log: { info: () => undefined, warn: () => undefined },
      checkpoint: { resumeFrom: null, save: async () => undefined },
      dryRun: false,
      signal: new AbortController().signal,
    });
  };
  const runAll = async () => {
    for (const { id } of steps) await runStep(id);
  };
  const plans = repositories.plans as MemoryNurturingOrganizationPlanRepository;
  return { plans, deliver, sync, runStep, runAll };
}

describe("given billing's log holds subscription facts from before the plan fold existed", () => {
  const facts = () => [
    subscriptionChanged({ plan: "FREE", at: 1_000 }),
    subscriptionChanged({ plan: "LAUNCH", at: 3_000, fromCatchUp: true }),
    subscriptionChanged({ plan: "GROWTH", at: 3_000 }),
    subscriptionChanged({ plan: "FREE", at: 2_000 }),
  ];

  /** @scenario "The deploy replay fills the plan copy as live delivery would, and sends nothing" */
  it("fills the copy as live delivery of the same facts does, and a second run changes nothing", async () => {
    const seeded = facts();
    const worker = deploy(seeded.map(logged));
    const live = liveWorker({ deliver: vi.fn(async () => undefined) });
    for (const fact of seeded) await live.record(fact);

    await worker.runStep(PLANS_STEP);
    const replayed = await held(worker.plans);
    await worker.runStep(PLANS_STEP);

    expect(replayed).toEqual(await held(live.store));
    expect(replayed).toMatchObject({ winnerEventId: seeded[2]?.id });
    await expect(held(worker.plans)).resolves.toEqual(replayed);
    await live.eventSourcing.close();
  });

  /** @scenario "The deploy replay fills the plan copy as live delivery would, and sends nothing" */
  it("sends nothing for a fact that wins the copy and would send live", async () => {
    const seeded = facts();
    const worker = deploy(seeded.map(logged));

    await worker.runStep(PLANS_STEP);

    await expect(held(worker.plans)).resolves.toMatchObject({ winnerEventId: seeded[2]?.id });
    expect(worker.deliver).not.toHaveBeenCalled();
  });

  /** @scenario "The deploy replay fills the plan copy as live delivery would, and sends nothing" */
  it("still sends a newer live fact exactly once over the replayed copy, and an older one not at all", async () => {
    const seeded = facts();
    const worker = deploy(seeded.map(logged));
    await worker.runStep(PLANS_STEP);
    const cio = await recordingDelivery();
    const live = liveWorker({ deliver: cio.deliver, store: worker.plans });
    const older = subscriptionChanged({ plan: "FREE", at: 2_500 });
    const newer = subscriptionChanged({ plan: "ENTERPRISE", at: 4_000 });

    await live.record(older);
    await live.record(newer);

    await vi.waitFor(() => expect(cio.groupPlans()).toEqual(["enterprise"]));
    await live.eventSourcing.close();
  });
});

describe("given every nurturing replay step runs over seeded owner logs", () => {
  const facts = () => [
    subscriptionChanged({ plan: "LAUNCH", at: 1_000 }),
    subscriptionChanged({ plan: "GROWTH", at: 2_000 }),
  ];

  /** @scenario "The deploy replay fills the plan copy as live delivery would, and sends nothing" */
  it("makes no send, sync, count or creation call, the plan facts that would send live included", async () => {
    const evaluation: ReplayEvent = {
      id: "evaluation-1",
      aggregateId: "evaluation-1",
      aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
      tenantId: "project-1",
      createdAt: BASE_MS,
      timestamp: BASE_MS,
      occurredAt: BASE_MS,
      type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
      version: EVALUATION_LIFECYCLE_EVENT_VERSION,
      idempotencyKey: "evaluation-1",
      data: {
        tenantId: "project-1",
        projectId: "project-1",
        evaluationId: "evaluation-1",
        occurredAt: BASE_MS,
      },
    };
    const worker = deploy([...facts().map(logged), evaluation]);

    await worker.runAll();

    expect(worker.deliver).not.toHaveBeenCalled();
    for (const hook of Object.values(worker.sync)) expect(hook).not.toHaveBeenCalled();
    await expect(held(worker.plans)).resolves.not.toBeNull();
  });
});
