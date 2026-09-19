/**
 * Shared setup for the Instant Evals REST suites: a seeded project, a fake run
 * service behind `setInstantEvalRunService`, and the row shapes the wire reads
 * back.
 *
 * Not a suite itself, so vitest does not collect it.
 *
 * @see ../[[...route]]/app.ts
 */

import { nanoid } from "nanoid";
import { afterEach, beforeEach, vi } from "vitest";

import { projectFactory } from "~/factories/project.factory";
import type {
  Organization,
  Project,
  Team,
  User,
} from "~/generated/prisma/client";
import { generateApiKeyToken } from "~/server/api-key/api-key-token.utils";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import type {
  InstantEvalJudgment,
  InstantEvalRunService,
} from "~/server/app-layer/instant-evals/run";
import { setInstantEvalRunService } from "~/server/app-layer/instant-evals/run";
import type { InstantEvalRunRow } from "~/server/app-layer/instant-evals/run/instant-eval-run.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { app } from "../[[...route]]/app";

export const BASE = "/api/v1/instant-evals";

export const SQL =
  "SELECT TraceId, eval('the customer is angry') AS angry FROM traces";

/** The stored question shape a run carries, which the wire reads back. */
const storedQuestion = (id: string) => ({
  id,
  function: "eval",
  kind: "boolean",
  reads: "probability",
  question: { id, kind: "boolean", text: "the customer is angry" },
  threshold: 0.5,
});

/** One fake per method the wire may call, so a missed call cannot pass green. */
export interface InstantEvalRunServiceFakes {
  create: ReturnType<typeof vi.fn>;
  estimate: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  results: ReturnType<typeof vi.fn>;
  sample: ReturnType<typeof vi.fn>;
}

/**
 * Seeds the project and the fake service around every test in the calling file,
 * and answers the request helpers and row builders the tests read.
 *
 * `flag` is the file's own hoisted feature-gate holder, and `allows` decides
 * what a scoped key's declared permission answers.
 */
export function setupInstantEvalsApiHarness({
  flag,
  allows = () => true,
}: {
  flag: { value: boolean };
  allows?: (permission: string) => boolean;
}) {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let testUserIds: string[];
  let testApiKeyIds: string[];
  let runs: InstantEvalRunServiceFakes;

  const headers = (extra: Record<string, string> = {}) => ({
    "X-Auth-Token": testApiKey,
    "Content-Type": "application/json",
    ...extra,
  });

  const api = {
    get: (path: string, extra: Record<string, string> = {}) =>
      app.request(path, { headers: headers(extra) }),
    post: (path: string, body: unknown, extra: Record<string, string> = {}) =>
      app.request(path, {
        method: "POST",
        headers: headers(extra),
        body: JSON.stringify(body),
      }),
  };

  /** One stored run row, in the shape the repository answers with. */
  function runRow(
    overrides: Partial<InstantEvalRunRow> = {},
  ): InstantEvalRunRow {
    return {
      id: `instant_eval_${nanoid(8)}`,
      projectId: testProjectId,
      name: null,
      sql: SQL,
      parameters: {},
      questions: [storedQuestion("angry")],
      plan: [{ function: "eval", column: "angry" }],
      rowLimit: 10_000,
      status: "QUEUED",
      total: null,
      progress: 0,
      matched: 0,
      matchedByQuestion: {},
      failed: 0,
      skipped: 0,
      tokens: 0,
      costUsd: 0,
      priceUsd: 0,
      error: null,
      createdAt: new Date("2026-09-18T10:00:00.000Z"),
      updatedAt: new Date("2026-09-18T10:00:00.000Z"),
      startedAt: null,
      finishedAt: null,
      occurredAt: null,
      acceptedAt: null,
      lastEventId: null,
      projectionVersion: null,
      ...overrides,
    };
  }

  /** One judgement, in the shape the judgements repository answers with. */
  function judgment(
    overrides: Partial<InstantEvalJudgment> = {},
  ): InstantEvalJudgment {
    return {
      traceId: `trace-${nanoid(6)}`,
      questionId: "angry",
      threadId: "thread-1",
      spanId: "span-1",
      kind: "boolean",
      status: "judged",
      passed: true,
      score: null,
      label: null,
      probability: 0.91,
      probabilities: null,
      error: null,
      occurredAt: "2026-09-18 10:00:00.000",
      ...overrides,
    };
  }

  beforeEach(async () => {
    await resetApp();
    flag.value = true;
    globalForApp.__langwatch_app = createTestApp({
      // The ceiling has its own tests. What these need from it is only that a
      // scoped key's declared permission decides whether it reaches the
      // handler, which is what the read-only scenario reads.
      permissions: {
        hasApiKeyPermission: async ({ permission }: { permission: string }) =>
          allows(permission),
      },
    } as unknown as Parameters<typeof createTestApp>[0]);

    runs = {
      create: vi.fn(),
      estimate: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      results: vi.fn(),
      sample: vi.fn(),
    };
    setInstantEvalRunService(runs as unknown as InstantEvalRunService);

    testOrganization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });
    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });
    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });
    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;
    testUserIds = [];
    testApiKeyIds = [];
  });

  afterEach(async () => {
    setInstantEvalRunService(null);
    if (testApiKeyIds.length > 0) {
      await cleanupTestRows(prisma, [
        ["apiKey", { id: { in: testApiKeyIds } }],
      ]);
    }
    await prisma.project.delete({ where: { id: testProjectId } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
    if (testUserIds.length > 0) {
      await cleanupTestRows(prisma, [["user", { id: { in: testUserIds } }]]);
    }
    await resetApp();
  });

  /** A key bound to a person, which is the only kind the ceiling checks. */
  async function createUserKey(): Promise<{ user: User; token: string }> {
    const user = await prisma.user.create({
      data: { name: "Runner", email: `runner-${nanoid(6)}@example.com` },
    });
    testUserIds.push(user.id);
    const { token, lookupId, hashedSecret } = generateApiKeyToken();
    const key = await prisma.apiKey.create({
      data: {
        name: `runner key ${nanoid(6)}`,
        lookupId,
        hashedSecret,
        userId: user.id,
        organizationId: testOrganization.id,
      },
    });
    testApiKeyIds.push(key.id);
    return { user, token };
  }

  return {
    api,
    headers,
    runRow,
    judgment,
    createUserKey,
    get runs(): InstantEvalRunServiceFakes {
      return runs;
    },
    get projectId(): string {
      return testProjectId;
    },
  };
}
