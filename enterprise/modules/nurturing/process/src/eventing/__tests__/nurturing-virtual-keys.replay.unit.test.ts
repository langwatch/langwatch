import {
  InMemoryProcessStore,
  type ReplayEvent,
  ReplayService,
  projectionLaneReplayer,
  replayProjectionsOf,
  sealPipelineDefinition,
} from "@langwatch/eventing";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's key copy as a peer map filled at deploy: the real replay engine over seeded owner
 * logs, the module's own steps, memory repositories. The per-fact memory twin is the oracle.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { IDLE_REPLAY_CLAIMS_INDEX } from "@langwatch/eventing/testing";
import {
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  type RecordVkLifecycleCommandData,
  recordVkLifecycleCommandDataSchema,
} from "@langwatch/gateway-contract";
import {
  USER_ERASED_EVENT_TYPE as IDENTITY_USER_ERASED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import {
  isMigrationStep,
  type MigrationStep,
  type MigrationStepReport,
  QUEUE_TENANT_CLAIMS_FILL_STEP,
} from "@langwatch/upgrade/step";
import {
  USER_AGGREGATE_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
} from "@langwatch/user-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { NurturingModule } from "../../app/nurturing.app.ts";
import { nurturingProcessModule } from "../../nurturing.module.ts";
import { MemoryNurturingVirtualKeyRepository } from "../../repositories/memory/memory.nurturing-gateway-key.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingVirtualKeyRepository } from "../../repositories/nurturing-gateway-key.repository.ts";
import { virtualKeyFactOf } from "../../rules/nurturing-virtual-key.rules.ts";
import { peopleWithEmails } from "../../services/__tests__/nurturing-person-email.test-helpers.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  nurturingProjectUsageEventing,
} from "../nurturing-project-usage.pipeline.ts";
import {
  ADMIN_USER_ID,
  gatewayEvent,
  lifecycleFact,
  liveSubscribersOf,
  ORGANIZATION_ID,
} from "./nurturing-gateway-facts.test-helpers.ts";
import {
  ADMINS_STEP,
  AUTH_MEMBERS_STEP,
  MEMBERS_STEP,
  ORGANIZATIONS_CREATED_STEP,
  PLACEMENTS_STEP,
} from "./nurturing-organization-copies.test-helpers.ts";
import { allNurturingOwnerStandIns } from "./nurturing-owner-stand-ins.test-helpers.ts";
import {
  LAST_TRACES_STEP,
  PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
  PERSONAL_OWNERS_OF_PROJECT_STEP,
  TRACED_PROJECTS_OF_PROJECT_STEP,
  TRACED_PROJECTS_OF_TRACE_STEP,
} from "./nurturing-project-copies.test-helpers.ts";
import {
  EVALUATION_DAYS_STEP,
  IDENTITY_MARKS_STEP,
  KEYS_STEP,
  nurturingReplayStepsOver,
  PLANS_STEP,
  USER_MARKS_STEP,
} from "./nurturing-replay-steps.test-helpers.ts";
import { NurturingSeededLog } from "./nurturing-seeded-log.test-helpers.ts";
import {
  TRACE_DAY_FAILURES_STEP,
  TRACE_DAY_SPANS_STEP,
} from "./nurturing-trace-days.test-helpers.ts";
import { RecordingCustomerIoChannel } from "./recording-customer-io-channel.test-helpers.ts";

const BASE_MS = 1_700_000_000_000;
const KEYS_LANE = `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.virtualKeys`;

const keyId = (n: number) => `vk_${n}`;

let sequence = 0;
/** One of gateway's key facts as its log holds it, in the order the test appends it. */
function gatewayFact(overrides: Partial<RecordVkLifecycleCommandData>): ReplayEvent {
  const data = lifecycleFact(overrides);
  const n = ++sequence;
  return {
    id: `gateway-${n}`,
    aggregateId: `vk:${data.virtual_key_id}:${data.action}:${n}`,
    aggregateType: "governance_subject",
    tenantId: data.tenantId,
    createdAt: BASE_MS + n,
    timestamp: BASE_MS + n,
    occurredAt: data.occurred_at,
    type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
    version: "2026-07-31",
    idempotencyKey: `gateway-${n}`,
    data,
  };
}

/** User's erasure fact, keyed by the user's own id as user keys its facts. */
function userErased(userId: string): ReplayEvent {
  const n = ++sequence;
  return {
    id: `user-${n}`,
    aggregateId: userId,
    aggregateType: USER_AGGREGATE_TYPE,
    tenantId: userId,
    createdAt: BASE_MS + n,
    timestamp: BASE_MS + n,
    occurredAt: BASE_MS + n,
    type: USER_ERASED_EVENT_TYPE,
    version: USER_LIFECYCLE_EVENT_VERSION,
    idempotencyKey: `user-${n}`,
    data: { tenantId: userId, userId, occurredAt: BASE_MS + n },
  };
}

/** Identity's erasure fact: it names the same account under identity's own event type. */
function identityErased(userId: string): ReplayEvent {
  const n = ++sequence;
  return {
    id: `identity-${n}`,
    aggregateId: userId,
    aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
    tenantId: "identity",
    createdAt: BASE_MS + n,
    timestamp: BASE_MS + n,
    occurredAt: BASE_MS + n,
    type: IDENTITY_USER_ERASED_EVENT_TYPE,
    version: "2026-08-20",
    idempotencyKey: `identity-${n}`,
    data: { userId, erasedIdentifierIds: ["identifier-1"], actor: { type: "user", id: "admin" } },
  };
}

/** The real lane replayer over a log and the lanes the registered pipelines declare. */
const laneReplayerOver = (
  log: NurturingSeededLog,
  projections: ReturnType<typeof replayProjectionsOf>,
) =>
  projectionLaneReplayer({
    service: new ReplayService({
      claims: IDLE_REPLAY_CLAIMS_INDEX,
      eventSource: log,
      redis: memoryRedisDouble({
        script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
      }),
    }),
    projections,
  });

/** How a step runs: for real or dry, from the start or from the report a failed run saved. */
type StepRunOptions = { dryRun?: boolean; resumeFrom?: MigrationStepReport | null };

/** A worker's deploy over the seeded owner logs: nurturing's own steps and its memory copies. */
function deploy({
  events,
  keys,
}: {
  events: ReplayEvent[];
  /** Wraps the key copy the two lanes write, to fail or interleave a write. */
  keys?: (inner: NurturingVirtualKeyRepository) => NurturingVirtualKeyRepository;
}) {
  const repositories = MemoryNurturingRepositories.create();
  const log = new NurturingSeededLog(events);
  const pipeline = buildNurturingProjectUsagePipeline({
    store: repositories.projectUsage,
    evaluationDays: repositories.evaluationDays,
    traceDays: repositories.traceDays,
    copies: {
      placements: repositories.placements,
      organizationsCreated: repositories.organizationsCreated,
      admins: repositories.milestones,
      members: repositories.members,
      virtualKeys: keys ? keys(repositories.virtualKeys) : repositories.virtualKeys,
      personalProjects: repositories.personalProjects,
      tracedProjects: repositories.tracedProjects,
      lastTraces: repositories.milestones,
    },
    plans: { store: repositories.plans, deliver: async () => undefined },
    sync: undefined,
  });
  const projections = replayProjectionsOf([
    ...allNurturingOwnerStandIns(),
    sealPipelineDefinition(pipeline),
  ]);
  const steps = nurturingReplayStepsOver(laneReplayerOver(log, projections));
  const step = (id: string): MigrationStep => {
    const found = steps.find((each) => each.id === id);
    if (!found || !isMigrationStep(found)) throw new Error(`no step ${id}`);
    return found;
  };
  const run = (id: string, { dryRun = false, resumeFrom = null }: StepRunOptions = {}) =>
    step(id).run({
      log: { info: () => undefined, warn: () => undefined },
      checkpoint: { resumeFrom, save: async () => undefined },
      dryRun,
      signal: new AbortController().signal,
    });
  /** Every step in the order the module declares them, as the upgrade runner orders them. */
  const runAll = async () => {
    for (const { id } of steps) await run(id);
  };
  const rows = (...ids: number[]) =>
    Promise.all(
      ids.map((id) =>
        repositories.virtualKeys.findKey({
          organizationId: ORGANIZATION_ID,
          virtualKeyId: keyId(id),
        }),
      ),
    );
  return { repositories, log, steps, step, run, runAll, rows, projections };
}

/** What per-fact live delivery of the facts (after the marks) leaves: the oracle's rows. */
async function perFactRows({
  facts,
  erased = [],
  ids,
}: {
  facts: ReplayEvent[];
  erased?: string[];
  ids: number[];
}) {
  const twin = MemoryNurturingVirtualKeyRepository.create();
  for (const userId of erased) await twin.forgetUser({ userId });
  for (const { data } of facts) {
    const fact = virtualKeyFactOf(recordVkLifecycleCommandDataSchema.parse(data));
    await twin.recordKeyFact({ fact });
  }
  return Promise.all(
    ids.map((id) => twin.findKey({ organizationId: ORGANIZATION_ID, virtualKeyId: keyId(id) })),
  );
}

function keysLaneOf(projections: ReturnType<typeof replayProjectionsOf>) {
  const lane = projections.mapProjections.find(
    ({ projectionName }) => projectionName === KEYS_LANE,
  );
  if (!lane) throw new Error(`no lane ${KEYS_LANE}`);
  return lane;
}

const namesAnyone = (rows: unknown, people: string[]) =>
  people.some((person) => JSON.stringify(rows).includes(person));

describe("given gateway's log holds keys created before the copy existed", () => {
  /** @scenario "A key created before the copy existed is copied at deploy from gateway's log" */
  it("fills each key as live delivery of the same facts would", async () => {
    const facts = [
      gatewayFact({ virtual_key_id: keyId(1), occurred_at: 1_000 }),
      gatewayFact({
        virtual_key_id: keyId(1),
        action: "rotated",
        actor_user_id: null,
        principal_user_id: "user-next",
        occurred_at: 2_000,
      }),
      gatewayFact({ virtual_key_id: keyId(2), action: "disabled", occurred_at: 3_000 }),
    ];
    const worker = deploy({ events: facts });

    await worker.runAll();

    const rows = await worker.rows(1, 2);
    expect(rows).toEqual(await perFactRows({ facts, ids: [1, 2] }));
    expect(rows[0]).toMatchObject([
      { keyCreatedAt: 1_000, creatorUserId: "user-creator", principalUserId: "user-next" },
    ]);
  });

  /** @scenario "A key with no created fact in the log is copied with no creation time" */
  it("copies a key with no created fact in the log with keyCreatedAt null", async () => {
    const worker = deploy({
      events: [gatewayFact({ virtual_key_id: keyId(3), action: "rotated", occurred_at: 2_000 })],
    });

    await worker.runAll();

    await expect(worker.rows(3)).resolves.toMatchObject([[{ keyCreatedAt: null }]]);
  });

  /** @scenario "A fact naming another organization changes no copied key" */
  it("leaves a copied key as it is when a later fact names another organization", async () => {
    const created = gatewayFact({ virtual_key_id: keyId(4), occurred_at: 1_000 });
    const elsewhere = gatewayFact({
      virtual_key_id: keyId(4),
      organization_id: "org-elsewhere",
      action: "revoked",
      occurred_at: 2_000,
    });
    const worker = deploy({ events: [created, elsewhere] });

    await worker.runAll();

    expect(await worker.rows(4)).toEqual(await perFactRows({ facts: [created], ids: [4] }));
  });

  /** @scenario "Replaying the key copy twice leaves every row as it was" */
  it("leaves the rows byte-identical after a second run, trailing pass included", async () => {
    const worker = deploy({
      events: [
        gatewayFact({ virtual_key_id: keyId(5), occurred_at: 1_000 }),
        gatewayFact({ virtual_key_id: keyId(5), action: "rotated", occurred_at: 2_000 }),
        gatewayFact({ virtual_key_id: keyId(6), action: "revoked", occurred_at: 3_000 }),
      ],
    });
    await worker.runAll();
    const first = JSON.stringify(await worker.rows(5, 6));

    await worker.run(KEYS_STEP);

    expect(JSON.stringify(await worker.rows(5, 6))).toBe(first);
  });
});

describe("given people were erased before nurturing kept erasure marks", () => {
  const people = { user: "user-erased-in-user-log", identity: "user-erased-in-identity-log" };
  const facts = () => [
    gatewayFact({
      virtual_key_id: keyId(10),
      actor_user_id: people.user,
      principal_user_id: people.identity,
      occurred_at: 1_000,
    }),
    gatewayFact({
      virtual_key_id: keyId(11),
      action: "rotated",
      principal_user_id: people.user,
      occurred_at: 2_000,
    }),
  ];

  const logOf = (gateway: ReplayEvent[]) => [
    ...gateway,
    userErased(people.user),
    identityErased(people.identity),
  ];

  /** @scenario "The deploy replay stores no person erased before the copy existed" */
  it("stores neither person from either log, after the steps run in the declared order", async () => {
    const worker = deploy({ events: logOf(facts()) });

    await worker.runAll();

    expect(namesAnyone(await worker.rows(10, 11), Object.values(people))).toBe(false);
    await expect(
      worker.repositories.erasedUsers.findErased({ userIds: Object.values(people) }),
    ).resolves.toHaveLength(2);
  });

  /** @scenario "The deploy replay stores no person erased before the copy existed" */
  it("declares the key step after both marks steps, which come first in the list", () => {
    const { steps } = deploy({ events: [] });

    const ids = steps.map(({ id }) => id);
    expect(ids.indexOf(KEYS_STEP)).toBeGreaterThan(ids.indexOf(USER_MARKS_STEP));
    expect(ids.indexOf(KEYS_STEP)).toBeGreaterThan(ids.indexOf(IDENTITY_MARKS_STEP));
    expect(steps.find(({ id }) => id === KEYS_STEP)).toMatchObject({
      after: [USER_MARKS_STEP, IDENTITY_MARKS_STEP, QUEUE_TENANT_CLAIMS_FILL_STEP],
    });
  });

  /** @scenario "The deploy replay stores no person erased before the copy existed" */
  it("would store them if the key step ran first, and a marks step run after it clears them", async () => {
    const worker = deploy({ events: logOf(facts()) });

    await worker.run(KEYS_STEP);
    expect(namesAnyone(await worker.rows(10, 11), Object.values(people))).toBe(true);
    await worker.run(USER_MARKS_STEP);
    await worker.run(IDENTITY_MARKS_STEP);

    expect(namesAnyone(await worker.rows(10, 11), Object.values(people))).toBe(false);
  });

  /** @scenario "The deploy replay stores no person erased before the copy existed" */
  it("fails the marks step, which the runner orders the key step after, when a mark cannot be written", async () => {
    const worker = deploy({
      events: [userErased(people.user)],
      keys: (inner) => ({
        recordKeyFact: (input) => inner.recordKeyFact(input),
        findKey: (input) => inner.findKey(input),
        forgetUser: async () => {
          throw new Error("postgres is down");
        },
      }),
    });

    await expect(worker.run(USER_MARKS_STEP)).rejects.toMatchObject({
      code: "projection_lane_replay_failed",
    });
  });

  /** @scenario "A resumed replay stores no erased person and moves no stamp back" */
  it("leaves the rows as they were when the key step runs again from its own report", async () => {
    const worker = deploy({ events: logOf(facts()) });
    await worker.run(USER_MARKS_STEP);
    await worker.run(IDENTITY_MARKS_STEP);
    const first = await worker.run(KEYS_STEP);
    const before = JSON.stringify(await worker.rows(10, 11));

    await worker.run(KEYS_STEP, { resumeFrom: first ?? null });

    expect(JSON.stringify(await worker.rows(10, 11))).toBe(before);
    expect(namesAnyone(await worker.rows(10, 11), Object.values(people))).toBe(false);
  });
});

describe("given two holder facts share a stamp and one names an erased person", () => {
  /** @scenario "Two holder facts at one stamp, one naming an erased person, end the same in either order" */
  it("makes the other person the holder in either log order, and writes one statement a fact", async () => {
    const erased = "user-erased-tied";
    const holder = (id: number, userId: string) =>
      gatewayFact({
        virtual_key_id: keyId(id),
        action: "rotated",
        principal_user_id: userId,
        occurred_at: 2_000,
      });
    const worker = deploy({
      events: [
        userErased(erased),
        holder(20, erased),
        holder(20, "user-next"),
        holder(21, "user-next"),
        holder(21, erased),
      ],
    });

    await worker.runAll();

    await expect(worker.rows(20, 21)).resolves.toMatchObject([
      [{ principalUserId: "user-next", principalUserIdAt: 2_000 }],
      [{ principalUserId: "user-next", principalUserIdAt: 2_000 }],
    ]);
    // A batch write would fold a stamp's holders in memory, where the erased one can win a tie.
    expect(keysLaneOf(worker.projections).open((lane) => "bulkAppend" in lane.store)).toBe(false);
  });
});

describe("given a key's facts sit under two event tenants", () => {
  /** @scenario "A key whose facts sit under two tenants ends the same in either tenant order" */
  it.each([
    ["the creation under the first tenant", "project-1", "project-2"],
    ["the creation under the second tenant", "project-2", "project-1"],
  ])("holds the per-fact row with %s", async (_name, createdIn, rotatedIn) => {
    const facts = [
      gatewayFact({ virtual_key_id: keyId(30), tenantId: createdIn, occurred_at: 1_000 }),
      gatewayFact({
        virtual_key_id: keyId(30),
        tenantId: rotatedIn,
        action: "rotated",
        principal_user_id: "user-next",
        occurred_at: 2_000,
      }),
    ];
    const worker = deploy({ events: facts });

    await worker.runAll();

    const rows = await worker.rows(30);
    expect(rows).toEqual(await perFactRows({ facts, ids: [30] }));
    expect(rows[0]).toMatchObject([{ keyCreatedAt: 1_000, principalUserId: "user-next" }]);
  });
});

describe("given a person is erased while the key step replays", () => {
  /** @scenario "A person erased during the deploy replay is on no key after it" */
  it("leaves them on no key, whether their facts were replayed before or after", async () => {
    const person = "user-erased-mid-replay";
    const facts = [10, 11, 12].map((id) =>
      gatewayFact({ virtual_key_id: keyId(id), principal_user_id: person, occurred_at: 1_000 }),
    );
    let erasedOnce = false;
    const worker = deploy({
      events: facts,
      keys: (inner) => ({
        findKey: (input) => inner.findKey(input),
        forgetUser: (input) => inner.forgetUser(input),
        recordKeyFact: async (input) => {
          await inner.recordKeyFact(input);
          if (erasedOnce) return;
          erasedOnce = true;
          await inner.forgetUser({ userId: person });
        },
      }),
    });

    await worker.run(KEYS_STEP);

    expect(namesAnyone(await worker.rows(10, 11, 12), [person])).toBe(false);
  });
});

describe("given a fact lands in gateway's log while the key step's first pass runs", () => {
  /** @scenario "A key fact delivered during the cutover is in the copy after the trailing pass" */
  it("copies it in the trailing pass, from the cursor the first pass completed through", async () => {
    const worker = deploy({
      events: [gatewayFact({ virtual_key_id: keyId(40), occurred_at: 1_000 })],
    });
    const cutover = {
      ...gatewayFact({ virtual_key_id: keyId(41), occurred_at: 2_000 }),
      timestamp: Date.now(),
    };
    worker.log.onDiscovered = () => {
      worker.log.onDiscovered = () => undefined;
      worker.log.events.push(cutover);
    };

    await worker.run(KEYS_STEP);

    await expect(worker.rows(40, 41)).resolves.toMatchObject([
      [{ occurredAt: 1_000 }],
      [{ occurredAt: 2_000 }],
    ]);
  });
});

describe("given the key copy's write or a fact's schema fails", () => {
  /** @scenario "A failed key write fails the replay step, which resumes and fills the key on its next run" */
  it("fails the step on a failed write and fills the key on the next run", async () => {
    let failing = true;
    const worker = deploy({
      events: [gatewayFact({ virtual_key_id: keyId(50), occurred_at: 1_000 })],
      keys: (inner) => ({
        findKey: (input) => inner.findKey(input),
        forgetUser: (input) => inner.forgetUser(input),
        recordKeyFact: async (input) => {
          if (failing) throw new Error("postgres is down");
          await inner.recordKeyFact(input);
        },
      }),
    });

    await expect(worker.run(KEYS_STEP)).rejects.toMatchObject({
      code: "projection_lane_replay_failed",
    });
    failing = false;
    await worker.run(KEYS_STEP);

    await expect(worker.rows(50)).resolves.toMatchObject([[{ keyCreatedAt: 1_000 }]]);
  });

  /** @scenario "A key fact the contract refuses fails the replay and the live lane alike" */
  it("refuses a fact the contract's schema refuses, live and on replay, and blocks the group live", async () => {
    const refused = { ...gatewayFact({ virtual_key_id: keyId(51) }), data: { organization_id: 1 } };
    const worker = deploy({ events: [refused] });
    const { definition, open } = keysLaneOf(worker.projections);

    await expect(worker.run(KEYS_STEP)).rejects.toMatchObject({
      code: "projection_lane_replay_failed",
    });
    expect(() => open((lane) => lane.map(refused as never))).toThrow(/organization_id/);
    // Left unset, a spent write blocks its group (mapProjection.types.ts onExhausted), as asked.
    expect(definition.options?.onExhausted).toBeUndefined();
  });
});

describe("given the module's steps", () => {
  /** @scenario "The key copy's replay step names the lane the usage pipeline declares" */
  it("each replays a lane a registered pipeline declares, dry, under its own name", async () => {
    const worker = deploy({ events: [] });

    for (const { id } of worker.steps) {
      await expect(worker.run(id, { dryRun: true })).resolves.toMatchObject({
        lane: expect.stringContaining(`${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.`),
      });
    }
    await expect(worker.run(KEYS_STEP, { dryRun: true })).resolves.toMatchObject({
      lane: KEYS_LANE,
    });
  });

  /** @scenario "The key copy's replay step names the lane the usage pipeline declares" */
  it("refuses the subscriber's old lane name as one no pipeline declares", async () => {
    const worker = deploy({ events: [] });
    const replayer = laneReplayerOver(worker.log, worker.projections);

    await expect(
      replayer.replayLane({
        lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.virtualKeyCopy`,
        since: "1970-01-01T00:00:00Z",
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: "projection_lane_not_found" });
  });
});

/**
 * Every replay step nurturing.module.ts declares, in its declared order: each step's `after`
 * within nurturing names a step listed before it.
 */
const MODULE_STEPS = [
  USER_MARKS_STEP,
  IDENTITY_MARKS_STEP,
  KEYS_STEP,
  EVALUATION_DAYS_STEP,
  PLANS_STEP,
  PLACEMENTS_STEP,
  ORGANIZATIONS_CREATED_STEP,
  ADMINS_STEP,
  MEMBERS_STEP,
  AUTH_MEMBERS_STEP,
  PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
  PERSONAL_OWNERS_OF_PROJECT_STEP,
  TRACED_PROJECTS_OF_TRACE_STEP,
  TRACED_PROJECTS_OF_PROJECT_STEP,
  LAST_TRACES_STEP,
  TRACE_DAY_SPANS_STEP,
  TRACE_DAY_FAILURES_STEP,
] as const;

/**
 * A worker as it composes nurturing: the real app over memory copies and a recording Customer.io
 * channel, both event pipelines as the module's eventing builds them over that app, and the real
 * lane replayer over those pipelines, every owner's stand-in and the seeded log. The steps are
 * the ones `nurturingProcessModule.install` returns over that replayer. Install builds its
 * channels from the store tier and takes none, so the app it installs is built here, by the
 * same class.
 */
async function liveWorker({ events }: { events: ReplayEvent[] }) {
  const customerIo = new RecordingCustomerIoChannel();
  const repositories = MemoryNurturingRepositories.create();
  const app = await NurturingModule.create({
    dependencies: {
      users: peopleWithEmails(),
      organizations: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
    },
    config: {
      customerIoRegion: void 0,
      customerIoBaseUrl: void 0,
      posthogKey: void 0,
      posthogHost: void 0,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories,
    channels: { customerIo, posthog: void 0 },
  });
  // nurturingEventing builds `app.pipeline()`; the usage pipeline syncs, as a channel is present.
  const nurturing = app.pipeline();
  const usage = nurturingProjectUsageEventing.build({
    participation: "consume",
    repositories,
    app,
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const replayer = laneReplayerOver(
    new NurturingSeededLog(events),
    replayProjectionsOf([
      ...allNurturingOwnerStandIns(),
      sealPipelineDefinition(nurturing),
      sealPipelineDefinition(usage),
    ]),
  );
  const installed = await nurturingProcessModule.install({
    resources: new ResourceScope(),
    config: {
      customerIoRegion: void 0,
      customerIoBaseUrl: void 0,
      posthogKey: void 0,
      posthogHost: void 0,
    },
    repositorySelection: { tier: "memory", members: {} },
    role: "worker",
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    replayer,
    resolve: () => createApiFixture<never>(),
  });
  const steps = (installed.migrationSteps ?? []).filter(isMigrationStep);
  /** Every step the module declares, for real, in the order it declares them. */
  const runModuleSteps = async () => {
    for (const step of steps) {
      await step.run({
        log: { info: () => undefined, warn: () => undefined },
        checkpoint: { resumeFrom: null, save: async () => undefined },
        dryRun: false,
        signal: new AbortController().signal,
      });
    }
  };
  // The copied admin, a current member: who a created key that no member holds is told to.
  await repositories.milestones.recordOrganization({
    organizationId: ORGANIZATION_ID,
    adminUserId: ADMIN_USER_ID,
    seeded: false,
  });
  await repositories.members.recordMembershipChange({
    organizationId: ORGANIZATION_ID,
    userId: ADMIN_USER_ID,
    change: "joined",
    at: 1,
  });
  return {
    customerIo,
    repositories,
    steps,
    runModuleSteps,
    deliverLive: liveSubscribersOf(nurturing),
  };
}

describe("given a worker composing nurturing with a recording Customer.io channel", () => {
  const people = { user: "user-erased-before-deploy", identity: "identity-erased-before-deploy" };
  const createdKey = { virtual_key_id: keyId(60), occurred_at: 1_000 };
  let worker: Awaited<ReturnType<typeof liveWorker>>;

  beforeEach(async () => {
    worker = await liveWorker({
      events: [gatewayFact(createdKey), userErased(people.user), identityErased(people.identity)],
    });
  });

  describe("when every replay step the module installs runs over owner logs holding a created key", () => {
    it("sends nothing to Customer.io, while the steps fill the key copy and the marks", async () => {
      await worker.runModuleSteps();

      expect(worker.customerIo.requests).toEqual([]);
      expect(worker.steps.map(({ id }) => id)).toEqual(MODULE_STEPS);
      await expect(
        worker.repositories.virtualKeys.findKey({
          organizationId: ORGANIZATION_ID,
          virtualKeyId: createdKey.virtual_key_id,
        }),
      ).resolves.toMatchObject([{ keyCreatedAt: 1_000 }]);
      await expect(
        worker.repositories.erasedUsers.findErased({ userIds: Object.values(people) }),
      ).resolves.toHaveLength(2);
    });
  });

  describe("when the same created fact reaches the live virtualKeyCreated subscriber", () => {
    it("sends the one virtual_key_created track to the admin, so the channel is reachable", async () => {
      await worker.deliverLive(
        gatewayEvent({ type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE, data: lifecycleFact(createdKey) }),
      );

      expect(worker.customerIo.requests).toHaveLength(2);
      // The channel's batchOrThrow resolves through batch, so each send records as "batch".
      // The identify carrying the address is sent first, awaited, then the track.
      expect(worker.customerIo.requests).toMatchObject([
        {
          method: "batch",
          input: [
            {
              type: "identify",
              userId: ADMIN_USER_ID,
              traits: { email: `${ADMIN_USER_ID}@example.com` },
            },
          ],
        },
        {
          method: "batch",
          input: [{ type: "track", userId: ADMIN_USER_ID, event: "virtual_key_created" }],
        },
      ]);
    });
  });
});
