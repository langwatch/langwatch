/**
 * @vitest-environment node
 *
 * The Postgres side of the usage report against a real Postgres.
 *
 * The email-domain aggregation is a raw query, so two things are only true if
 * a database says so: that the SQL parses and groups the way the report
 * expects, and that the tenancy guard admits it. The Langy and pull request
 * counts cut their windows on columns other than `createdAt`, one of them an
 * epoch in milliseconds, which is exactly the kind of thing a stubbed client
 * would accept whatever was written. A unit test proves none of it.
 *
 * @see ../counts.ts
 * @see specs/self-hosting/connected-services/usage-report.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InstanceUsageStatsRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import { prisma } from "~/server/db";
import { collectUsageReport } from "../collect";
import { onboardingLadder, storedCounts, userEmailDomains } from "../counts";

const RUN = `usage-${Date.now()}`;
const DOMAIN = `${RUN}.acme.test`;
const OTHER = `${RUN}.other.test`;

const ORGANIZATION_ID = `org-${RUN}`;
const PROJECT_ID = `proj-${RUN}`;
/** Another install's project, which no count may reach. */
const OTHER_PROJECT_ID = `proj-other-${RUN}`;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
const THREE_DAYS_AGO = new Date(NOW.getTime() - 3 * DAY);
const TWENTY_DAYS_AGO = new Date(NOW.getTime() - 20 * DAY);
const FORTY_DAYS_AGO = new Date(NOW.getTime() - 40 * DAY);

describe("given users on two company domains", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        { name: "Ada", email: `ada@${DOMAIN}` },
        // Mixed case and padding, because a real directory has both and the
        // report must not carry the same company twice under two spellings.
        { name: "Grace", email: `  Grace@${DOMAIN.toUpperCase()}  ` },
        { name: "Kay", email: `kay@${OTHER}` },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        name: { in: ["Ada", "Grace", "Kay"] },
        email: { contains: RUN },
      },
    });
  });

  describe("when the domains are counted", () => {
    /** @scenario "Company identity travels as aggregated domains, never an address" */
    it("counts them in Postgres and returns no address", async () => {
      const counts = await userEmailDomains(prisma);

      expect(counts[DOMAIN]).toBe(2);
      expect(counts[OTHER]).toBe(1);
      expect(JSON.stringify(counts)).not.toContain("ada@");
    });
  });
});

/** A conversation projection row with the columns Postgres insists on. */
function conversation({
  conversationId,
  userId,
  createdAt,
  lastActivityAt,
  projectId = PROJECT_ID,
}: {
  conversationId: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date | null;
  projectId?: string;
}) {
  return {
    projectId,
    ConversationId: conversationId,
    UserId: userId,
    TitleSource: "derived" as const,
    Status: "idle",
    CreatedAt: createdAt.getTime(),
    UpdatedAt: createdAt.getTime(),
    OccurredAt: createdAt.getTime(),
    AcceptedAt: createdAt.getTime(),
    LastActivityAt: lastActivityAt?.getTime() ?? null,
    LastEventId: `event-${conversationId}`,
    ProjectionVersion: "1",
  };
}

/** A turn projection row, stamped in epoch milliseconds like the fold does. */
function turn({
  conversationId,
  turnId,
  createdAt,
  projectId = PROJECT_ID,
}: {
  conversationId: string;
  turnId: string;
  createdAt: Date;
  projectId?: string;
}) {
  return {
    projectId,
    ConversationId: conversationId,
    TurnId: turnId,
    Status: "completed",
    QuestionParts: [],
    AnswerParts: [],
    ToolCalls: [],
    CreatedAt: createdAt.getTime(),
    UpdatedAt: createdAt.getTime(),
    OccurredAt: createdAt.getTime(),
    AcceptedAt: createdAt.getTime(),
    LastEventId: `event-${turnId}`,
    ProjectionVersion: "1",
  };
}

function pullRequest({
  number,
  prCreatedAt,
  organizationId = ORGANIZATION_ID,
}: {
  number: number;
  prCreatedAt: Date;
  organizationId?: string;
}) {
  return {
    organizationId,
    repositoryHost: "github.com",
    repositoryFullName: `acme/${RUN}`,
    headBranch: `branch-${number}`,
    prNumber: number,
    htmlUrl: `https://github.com/acme/${RUN}/pull/${number}`,
    title: `Pull request ${number}`,
    state: "open",
    prCreatedAt,
    // The install noticed every one of them today, which must not be what
    // the window is cut on.
    createdAt: NOW,
  };
}

describe("given Langy conversations, turns and pull requests, some of them old", () => {
  const OTHER_ORGANIZATION_ID = `org-other-${RUN}`;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.createMany({
      data: [
        { id: ORGANIZATION_ID, name: `Usage ${RUN}`, slug: `usage-${RUN}` },
        {
          id: OTHER_ORGANIZATION_ID,
          name: `Usage other ${RUN}`,
          slug: `usage-other-${RUN}`,
        },
      ],
    });
    // The project the whole report resolves from, so the report can be taken
    // end to end against the real tenancy guards.
    await prisma.team.create({
      data: {
        id: `team-${RUN}`,
        name: `Usage team ${RUN}`,
        slug: `usage-team-${RUN}`,
        organizationId: ORGANIZATION_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Usage project ${RUN}`,
        slug: `usage-project-${RUN}`,
        teamId: `team-${RUN}`,
        language: "en",
        framework: "openai",
        apiKey: `usage-key-${RUN}`,
      },
    });

    // Ada has two conversations, one active this week and one long idle; Kay
    // one from twenty days ago; a stranger's install has one of its own.
    await prisma.langyConversationProjection.createMany({
      data: [
        conversation({
          conversationId: `conv-ada-1-${RUN}`,
          userId: `ada-${RUN}`,
          createdAt: FORTY_DAYS_AGO,
          lastActivityAt: THREE_DAYS_AGO,
        }),
        conversation({
          conversationId: `conv-ada-2-${RUN}`,
          userId: `ada-${RUN}`,
          createdAt: FORTY_DAYS_AGO,
          lastActivityAt: FORTY_DAYS_AGO,
        }),
        conversation({
          conversationId: `conv-kay-${RUN}`,
          userId: `kay-${RUN}`,
          createdAt: TWENTY_DAYS_AGO,
          lastActivityAt: null,
        }),
        conversation({
          conversationId: `conv-other-${RUN}`,
          userId: `stranger-${RUN}`,
          createdAt: THREE_DAYS_AGO,
          lastActivityAt: THREE_DAYS_AGO,
          projectId: OTHER_PROJECT_ID,
        }),
      ],
    });
    await prisma.langyConversationTurnProjection.createMany({
      data: [
        turn({
          conversationId: `conv-ada-1-${RUN}`,
          turnId: `turn-1-${RUN}`,
          createdAt: FORTY_DAYS_AGO,
        }),
        turn({
          conversationId: `conv-ada-1-${RUN}`,
          turnId: `turn-2-${RUN}`,
          createdAt: THREE_DAYS_AGO,
        }),
        turn({
          conversationId: `conv-kay-${RUN}`,
          turnId: `turn-3-${RUN}`,
          createdAt: TWENTY_DAYS_AGO,
        }),
        turn({
          conversationId: `conv-other-${RUN}`,
          turnId: `turn-other-${RUN}`,
          createdAt: THREE_DAYS_AGO,
          projectId: OTHER_PROJECT_ID,
        }),
      ],
    });
    await prisma.githubPullRequest.createMany({
      data: [
        pullRequest({ number: 1, prCreatedAt: FORTY_DAYS_AGO }),
        pullRequest({ number: 2, prCreatedAt: TWENTY_DAYS_AGO }),
        pullRequest({ number: 3, prCreatedAt: THREE_DAYS_AGO }),
        pullRequest({
          number: 4,
          prCreatedAt: THREE_DAYS_AGO,
          organizationId: OTHER_ORGANIZATION_ID,
        }),
      ],
    });
  });

  afterAll(async () => {
    const projects = { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } };
    await prisma.langyConversationTurnProjection.deleteMany({
      where: projects,
    });
    await prisma.langyConversationProjection.deleteMany({ where: projects });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: `team-${RUN}` } });
    // Pull requests go with their organizations.
    await prisma.organization.deleteMany({
      where: { id: { in: [ORGANIZATION_ID, OTHER_ORGANIZATION_ID] } },
    });
  });

  describe("when the stored counts are taken", () => {
    /** @scenario "Langy turns and the people sending them are counted" */
    it("counts turns by the fold's millisecond stamp and people by their last activity", async () => {
      const counts = await storedCounts({
        prisma,
        projectIds: [PROJECT_ID],
        organizationIds: [ORGANIZATION_ID],
        now: NOW,
      });

      expect(counts).toMatchObject({
        langy_turns: 3,
        langy_turns_7d: 1,
        langy_turns_28d: 2,
        langy_users: 2,
        langy_active_users_7d: 1,
        langy_active_users_28d: 2,
      });
    });

    /** @scenario "Pull requests are counted by the day they were opened" */
    it("windows pull requests on the day they were opened, not the day they were noticed", async () => {
      const counts = await storedCounts({
        prisma,
        projectIds: [PROJECT_ID],
        organizationIds: [ORGANIZATION_ID],
        now: NOW,
      });

      expect(counts).toMatchObject({
        pull_requests: 3,
        pull_requests_7d: 1,
        pull_requests_28d: 2,
      });
    });
  });

  describe("when the ladder is read", () => {
    /** @scenario "Langy turns and the people sending them are counted" */
    it("dates the first Langy turn from the oldest turn, as a date rather than a number", async () => {
      const ladder = await onboardingLadder({
        prisma,
        projectIds: [PROJECT_ID],
        organizationIds: [ORGANIZATION_ID],
      });

      expect(ladder.first_langy_turn_at).toBe(FORTY_DAYS_AGO.toISOString());
    });
  });

  describe("when the whole report is taken", () => {
    /** @scenario "Counts are reported lifetime and over two windows" */
    it("passes every tenancy guard on the way and carries the new families", async () => {
      // ClickHouse is covered by its own suite; here it answers nothing so
      // that what is under test is every Postgres read the report makes.
      const nothingIngested: InstanceUsageStatsRepository = {
        findTraceCount: async () => 0,
        findScenarioRunCount: async () => 0,
        findSpanCount: async () => 0,
        findGatewaySpend: async () => ({ requests: 0, spendUsd: 0 }),
        findInstantEvalRunCount: async () => 0,
        findInstantEvalJudgmentCount: async () => 0,
        findCodingAgentSessionCount: async () => 0,
        findFirstGatewayRequestAt: async () => null,
        findFirstInstantEvalRunAt: async () => null,
        findFirstCodingAgentSessionAt: async () => null,
      };

      const payload = await collectUsageReport({
        prisma,
        organizationIds: [ORGANIZATION_ID],
        instanceId: `instance-${RUN}`,
        firstSeenAt: null,
        repository: nothingIngested,
        now: NOW,
      });

      expect(payload).toMatchObject({
        projects: 1,
        langy_turns: 3,
        langy_users: 2,
        pull_requests: 3,
        first_langy_turn_at: FORTY_DAYS_AGO.toISOString(),
        first_model_provider_at: null,
        spans: 0,
      });
    });
  });
});
