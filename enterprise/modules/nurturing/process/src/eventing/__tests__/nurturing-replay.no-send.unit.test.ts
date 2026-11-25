// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Every nurturing replay step run over seeded owner logs, on a worker whose Customer.io and
 * PostHog channels are reachable and record what they are asked: the rows are written and the
 * channels hear nothing. The real module supplies the usage sync and the plan send, so a replay
 * that reached either would land in the recordings.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { SSO_AUTO_ADDED_EVENT_TYPE } from "@langwatch/auth-contract";
import {
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_EVENT_VERSION,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
} from "@langwatch/enterprise-billing-contract";
import {
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
} from "@langwatch/evaluation-contract";
import {
  createTenantId,
  type ReplayEvent,
  ReplayService,
  projectionLaneReplayer,
  replayProjectionsOf,
  sealPipelineDefinition,
} from "@langwatch/eventing";
import {
  GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
  GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
} from "@langwatch/gateway-contract";
import {
  USER_ERASED_EVENT_TYPE as IDENTITY_USER_ERASED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
  type OrganizationApi,
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
  PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
} from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { PROJECT_TRACED_EVENT_TYPE, TRACE_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { isMigrationStep, type MigrationStep } from "@langwatch/upgrade/step";
import {
  USER_AGGREGATE_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  type UserApi,
} from "@langwatch/user-contract";
import { beforeAll, describe, expect, it } from "vitest";

import { NurturingModule } from "../../app/nurturing.app.ts";
import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import type { MemoryNurturingPersonalProjectRepository } from "../../repositories/memory/memory.nurturing-personal-project.repository.ts";
import type { MemoryNurturingTracedProjectRepository } from "../../repositories/memory/memory.nurturing-traced-project.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { utcDayOf } from "../../rules/nurturing-time.rules.ts";
import { traceCountsOf } from "../../rules/nurturing-trace-day.rules.ts";
import { buildNurturingProjectUsagePipeline } from "../nurturing-project-usage.pipeline.ts";
import {
  firstRequestFact,
  lifecycleFact,
  unbudgetedSpendFact,
} from "./nurturing-gateway-facts.test-helpers.ts";
import {
  ADMINS_STEP,
  AUTH_MEMBERS_STEP,
  MEMBERS_STEP,
  ORGANIZATIONS_CREATED_STEP,
  organizationCopiesReplayStepsOver,
  PLACEMENTS_STEP,
} from "./nurturing-organization-copies.test-helpers.ts";
import { allNurturingOwnerStandIns } from "./nurturing-owner-stand-ins.test-helpers.ts";
import {
  LAST_TRACES_STEP,
  PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
  PERSONAL_OWNERS_OF_PROJECT_STEP,
  projectCopiesReplayStepsOver,
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
  spanReceived,
  TRACE_DAY_FAILURES_STEP,
  TRACE_DAY_SPANS_STEP,
  traceDayReplayStepsOver,
  traceFailed,
} from "./nurturing-trace-days.test-helpers.ts";
import { RecordingCustomerIoChannel } from "./recording-customer-io-channel.test-helpers.ts";

/** After both replay windows open: evaluation days since 2026-10-19, last traces since 2026-11-18. */
const AT = Date.UTC(2026, 10, 19, 12);
const DAY_MS = 24 * 60 * 60 * 1000;
const ORGANIZATION_ID = "org-1";

let sequence = 0;
/** An owner's fact as its log holds it, in the order the test appends it. */
function logged({
  type,
  aggregateType,
  aggregateId,
  tenantId,
  version = "2026-11-19",
  data,
}: {
  type: string;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  version?: string;
  data: Record<string, unknown>;
}): ReplayEvent {
  const n = ++sequence;
  return {
    id: `fact-${n}`,
    aggregateId,
    aggregateType,
    tenantId,
    createdAt: AT + n,
    timestamp: AT + n,
    occurredAt: AT,
    type,
    version,
    idempotencyKey: `fact-${n}`,
    data: { tenantId, occurredAt: AT, ...data },
  };
}

const organizationFact = (type: string, data: Record<string, unknown>) =>
  logged({
    type,
    aggregateType: ORGANIZATION_AGGREGATE_TYPE,
    aggregateId: ORGANIZATION_ID,
    tenantId: ORGANIZATION_ID,
    data: { organizationId: ORGANIZATION_ID, organizationName: "Acme", ...data },
  });

const projectFact = (type: string, projectId: string, data: Record<string, unknown>) =>
  logged({
    type,
    aggregateType: PROJECT_AGGREGATE_TYPE,
    aggregateId: projectId,
    tenantId: projectId,
    data: { projectId, organizationId: ORGANIZATION_ID, ...data },
  });

/**
 * One owner fact for each of the seventeen lanes the deploy replays: the two erasure marks, the
 * key, the evaluation day, the plan, the organization, project and trace copies, and the two
 * trace-day folds. Gateway's first-request and unbudgeted-spend facts sit in the log too: only a
 * live subscriber reads them, so no step sends them.
 */
function ownerLogs(): ReplayEvent[] {
  const gateway = lifecycleFact({ occurred_at: AT });
  const firstRequest = firstRequestFact({ occurred_at: AT });
  const unbudgeted = unbudgetedSpendFact({ occurred_at: AT });
  return [
    // User marks, identity marks.
    logged({
      type: USER_ERASED_EVENT_TYPE,
      aggregateType: USER_AGGREGATE_TYPE,
      aggregateId: "user-erased",
      tenantId: "user-erased",
      version: USER_LIFECYCLE_EVENT_VERSION,
      data: { userId: "user-erased" },
    }),
    logged({
      type: IDENTITY_USER_ERASED_EVENT_TYPE,
      aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
      aggregateId: "identity-erased",
      tenantId: "identity",
      version: "2026-08-20",
      data: {
        userId: "identity-erased",
        erasedIdentifierIds: ["identifier-1"],
        actor: { type: "user", id: "admin" },
      },
    }),
    // Keys.
    logged({
      type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
      aggregateType: "governance_subject",
      aggregateId: `vk:${gateway.virtual_key_id}:${gateway.action}`,
      tenantId: gateway.tenantId,
      version: "2026-07-31",
      data: gateway,
    }),
    logged({
      type: GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE,
      aggregateType: "governance_subject",
      aggregateId: `vk:${firstRequest.virtual_key_id}`,
      tenantId: firstRequest.tenantId,
      version: "2026-07-31",
      data: firstRequest,
    }),
    logged({
      type: GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
      aggregateType: "governance_subject",
      aggregateId: `org:${unbudgeted.organization_id}`,
      tenantId: unbudgeted.tenantId,
      version: "2026-07-31",
      data: unbudgeted,
    }),
    // Evaluation days.
    logged({
      type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
      aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
      aggregateId: "evaluation-1",
      tenantId: "project-ev",
      version: EVALUATION_LIFECYCLE_EVENT_VERSION,
      data: { projectId: "project-ev", evaluationId: "evaluation-1" },
    }),
    // Plans.
    logged({
      type: SUBSCRIPTION_CHANGED_EVENT_TYPE,
      aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
      aggregateId: ORGANIZATION_ID,
      tenantId: ORGANIZATION_ID,
      version: BILLING_LIFECYCLE_EVENT_VERSION,
      data: {
        organizationId: ORGANIZATION_ID,
        memberUserIds: ["user-member"],
        hasSubscription: true,
        plan: "GROWTH",
      },
    }),
    // Placements and admins read the same created fact; organization creations their own.
    projectFact(PROJECT_CREATED_EVENT_TYPE, "project-1", { adminUserId: "admin-a" }),
    organizationFact(ORGANIZATION_CREATED_EVENT_TYPE, {}),
    // Members from organization's log, then from auth's.
    organizationFact(INVITE_ACCEPTED_EVENT_TYPE, {
      userId: "invited",
      inviteId: "invite-1",
      role: "MEMBER",
    }),
    logged({
      type: SSO_AUTO_ADDED_EVENT_TYPE,
      aggregateType: "user",
      aggregateId: "sso",
      tenantId: ORGANIZATION_ID,
      data: { organizationId: ORGANIZATION_ID, userId: "sso", organizationName: "Acme" },
    }),
    // Personal-project owners from organization's log, then from project's.
    organizationFact(PERSONAL_TEAM_CREATED_EVENT_TYPE, {
      userId: "owner-1",
      teamId: "team-project-po",
      projectId: "project-po",
      projectSlug: "project-po",
    }),
    projectFact(PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE, "project-pp", {
      ownerUserId: "owner-2",
    }),
    // Traced projects from trace's log, then from project's.
    logged({
      type: PROJECT_TRACED_EVENT_TYPE,
      aggregateType: "trace_project_milestone",
      aggregateId: "project-tt",
      tenantId: "project-tt",
      data: { projectId: "project-tt", organizationId: ORGANIZATION_ID },
    }),
    projectFact(PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE, "project-tf", {}),
    // The last trace.
    logged({
      type: TRACE_RECEIVED_EVENT_TYPE,
      aggregateType: "trace_project_milestone",
      aggregateId: "project-lt",
      tenantId: "project-lt",
      data: { projectId: "project-lt", userId: "admin-1", organizationId: "org-trace" },
    }),
    // A root span and a failed trace, each counted on its own trace-day row.
    spanReceived({ id: "span-td", projectId: "project-td", createdAt: AT }),
    traceFailed({ id: "failed-td", projectId: "project-td", createdAt: AT }),
  ];
}

/**
 * A worker's deploy over the seeded owner logs: the real nurturing module on reachable recording
 * channels, its usage pipeline composed as the module composes it (usage sync and plan send
 * included), and every replay step the module declares, over the real replay engine.
 */
async function deploy(events: ReplayEvent[]) {
  const customerIo = new RecordingCustomerIoChannel();
  const posthog = MemoryPostHogChannel.create();
  const repositories = MemoryNurturingRepositories.create();
  const app = await NurturingModule.create({
    dependencies: {
      users: createApiFixture<UserApi>({}, "UserApi"),
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
    channels: { customerIo, posthog },
  });
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
    plans: { store: repositories.plans, deliver: (input) => app.deliverPlan(input) },
    sync: {
      usageChanged: (input) => app.organizationUsageChanged(input),
      tracesChanged: (input) => app.organizationTracesChanged(input),
      organizationCreated: (data) => app.organizationCreated(data),
    },
    logger: { warn: () => undefined },
  });
  const replayer = projectionLaneReplayer({
    service: new ReplayService({
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
  const steps: MigrationStep[] = [
    ...nurturingReplayStepsOver(replayer),
    ...organizationCopiesReplayStepsOver(replayer),
    ...projectCopiesReplayStepsOver(replayer),
    ...traceDayReplayStepsOver(replayer, { now: AT + DAY_MS }),
  ];
  /** Runs the named steps for real, in the declared order the caller lists them. */
  const run = async (ids: readonly string[]) => {
    for (const id of ids) {
      const step = steps.find((each) => each.id === id);
      if (!step || !isMigrationStep(step)) throw new Error(`no step ${id}`);
      await step.run({
        log: { info: () => undefined, warn: () => undefined },
        checkpoint: { resumeFrom: null, save: async () => undefined },
        dryRun: false,
        signal: new AbortController().signal,
      });
    }
  };
  /** Everything the two vendors were asked for since the deploy began. */
  const recorded = () => ({
    customerIo: customerIo.requests,
    posthog: {
      tracked: posthog.tracked,
      groups: posthog.groups,
      identified: posthog.identified,
    },
  });
  return { repositories, steps, run, recorded };
}

/** Every step in the order the module declares them, as the upgrade runner orders them. */
const ALL_STEPS = [
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

const NOTHING_RECORDED = {
  customerIo: [],
  posthog: { tracked: [], groups: [], identified: [] },
};

describe("given every replay step run over seeded owner logs on a worker with reachable channels", () => {
  let worker: Awaited<ReturnType<typeof deploy>>;

  beforeAll(async () => {
    worker = await deploy(ownerLogs());
    await worker.run(ALL_STEPS);
  });

  /** @scenario "A deploy replay sends nothing to Customer.io or PostHog" */
  it("declares exactly the steps the run covered", () => {
    expect(worker.steps.map(({ id }) => id)).toEqual(ALL_STEPS);
  });

  /** @scenario "A deploy replay sends nothing to Customer.io or PostHog" */
  it("records no request on Customer.io and no event, group or identify on PostHog", () => {
    expect(worker.recorded()).toEqual(NOTHING_RECORDED);
  });

  describe("when the rows are read back", () => {
    const rows = () => worker.repositories;

    it("holds the erased person's mark from user's log", async () => {
      await expect(rows().erasedUsers.findErased({ userIds: ["user-erased"] })).resolves.toEqual([
        "user-erased",
      ]);
    });

    it("holds the erased person's mark from identity's log", async () => {
      await expect(
        rows().erasedUsers.findErased({ userIds: ["identity-erased"] }),
      ).resolves.toEqual(["identity-erased"]);
    });

    it("holds the key gateway's log created", async () => {
      await expect(
        rows().virtualKeys.findKey({ organizationId: ORGANIZATION_ID, virtualKeyId: "vk_1" }),
      ).resolves.toMatchObject([{ keyCreatedAt: AT }]);
    });

    it("holds the day evaluation's log completed on", async () => {
      await expect(
        rows().evaluationDays.findForProjects({ projectIds: ["project-ev"], afterDay: "" }),
      ).resolves.toEqual([{ projectId: "project-ev", day: utcDayOf(AT) }]);
    });

    it("holds the plan billing's log changed to", async () => {
      const context = {
        aggregateId: ORGANIZATION_ID,
        tenantId: createTenantId(ORGANIZATION_ID),
      };

      await expect(rows().plans.get(ORGANIZATION_ID, context)).resolves.toMatchObject({
        kind: "folded",
        state: { held: { outcome: "held", fact: { plan: "GROWTH" } } },
      });
    });

    it("places the project project's log created in its organization", async () => {
      await expect(
        rows().placements.findProjectIds({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual(["project-1"]);
    });

    it("holds the organization's creation time", async () => {
      await expect(
        rows().organizationsCreated.findOrganizationCreatedAt({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual({ organizationCreatedAt: AT });
    });

    it("names the admin project's created fact named", async () => {
      await expect(
        rows().milestones.findOrganization({ organizationId: ORGANIZATION_ID }),
      ).resolves.toMatchObject([{ adminUserId: "admin-a" }]);
    });

    it("holds the members organization's and auth's logs joined", async () => {
      const memberships = await rows().members.findMembershipsOfUsers({
        userIds: ["invited", "sso"],
      });

      expect(memberships.map(({ userId }) => userId).toSorted()).toEqual(["invited", "sso"]);
    });

    it("holds the personal owners both logs named", () => {
      const personal = rows().personalProjects as MemoryNurturingPersonalProjectRepository;

      expect(
        personal
          .storedRows()
          .map(({ projectId }) => projectId)
          .toSorted(),
      ).toEqual(["project-po", "project-pp"]);
    });

    it("holds the traced projects both logs named", () => {
      const traced = rows().tracedProjects as MemoryNurturingTracedProjectRepository;

      expect(
        traced
          .storedRows()
          .map(({ projectId }) => projectId)
          .toSorted(),
      ).toEqual(["project-tf", "project-tt"]);
    });

    it("holds the organization's latest trace time", async () => {
      await expect(
        rows().milestones.findLastTraceAt({ organizationId: "org-trace" }),
      ).resolves.toBe(AT);
    });

    it("holds the trace day's spans row and failures row trace's logs counted", async () => {
      const days = await rows().traceDays.findForProjects({
        projectIds: ["project-td"],
        afterDay: "",
      });

      expect(traceCountsOf({ days, windowStartDay: "" })).toMatchObject({
        traceCount: 1,
        errorCount: 1,
        activeDays: [utcDayOf(AT)],
      });
    });
  });
});

describe("given only the traced-projects replay run over trace's and project's logs", () => {
  /** @scenario "A deploy replay sends nothing to Customer.io or PostHog" */
  it("records no request on Customer.io and no event, group or identify on PostHog", async () => {
    const worker = await deploy(ownerLogs());

    await worker.run([TRACED_PROJECTS_OF_TRACE_STEP, TRACED_PROJECTS_OF_PROJECT_STEP]);

    expect(worker.recorded()).toEqual(NOTHING_RECORDED);
  });

  it("still writes a traced row for each project the logs name", async () => {
    const worker = await deploy(ownerLogs());

    await worker.run([TRACED_PROJECTS_OF_TRACE_STEP, TRACED_PROJECTS_OF_PROJECT_STEP]);

    const traced = worker.repositories.tracedProjects as MemoryNurturingTracedProjectRepository;
    expect(
      traced
        .storedRows()
        .map(({ projectId }) => projectId)
        .toSorted(),
    ).toEqual(["project-tf", "project-tt"]);
  });
});
