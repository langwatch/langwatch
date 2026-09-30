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
import type { Organization, Team, User } from "~/generated/prisma/client";
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

/** The rows one test owns, and the ids of what it created on the way. */
interface SeededProject {
  apiKey: string;
  projectId: string;
  organization: Organization;
  team: Team;
  userIds: string[];
  apiKeyIds: string[];
}

/** A fresh organization, team and project around every test, gone after it. */
function useSeededProject(): { readonly current: () => SeededProject } {
  let seeded: SeededProject | null = null;

  beforeEach(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });
    const team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    const project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    seeded = {
      apiKey: project.apiKey,
      projectId: project.id,
      organization,
      team,
      userIds: [],
      apiKeyIds: [],
    };
  });

  afterEach(async () => {
    if (!seeded) return;
    if (seeded.apiKeyIds.length > 0) {
      await cleanupTestRows(prisma, [
        ["apiKey", { id: { in: seeded.apiKeyIds } }],
      ]);
    }
    await prisma.project.delete({ where: { id: seeded.projectId } });
    await prisma.team.delete({ where: { id: seeded.team.id } });
    await prisma.organization.delete({ where: { id: seeded.organization.id } });
    if (seeded.userIds.length > 0) {
      await cleanupTestRows(prisma, [["user", { id: { in: seeded.userIds } }]]);
    }
    seeded = null;
  });

  return {
    current: () => {
      if (!seeded)
        throw new Error("the seeded project is only there inside a test");
      return seeded;
    },
  };
}

/**
 * The app on a permission fake and the run service on method fakes, around
 * every test, torn down after it.
 */
function useFakeRunService({
  flag,
  allows,
}: {
  flag: { isEnabled: boolean };
  allows: (permission: string) => boolean;
}): { readonly current: () => InstantEvalRunServiceFakes } {
  let runs: InstantEvalRunServiceFakes | null = null;

  beforeEach(async () => {
    await resetApp();
    flag.isEnabled = true;
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
  });

  afterEach(async () => {
    setInstantEvalRunService(null);
    runs = null;
    await resetApp();
  });

  return {
    current: () => {
      if (!runs)
        throw new Error("the fake run service is only there inside a test");
      return runs;
    },
  };
}

/** Requests against the mounted family, authenticated as the seeded project. */
function requestClient(apiKey: () => string) {
  const headers = (extra: Record<string, string> = {}) => ({
    "X-Auth-Token": apiKey(),
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
  return { api, headers };
}

/** The row shapes the repositories answer with, which the wire reads back. */
function rowFactories(projectId: () => string) {
  function runRow(
    overrides: Partial<InstantEvalRunRow> = {},
  ): InstantEvalRunRow {
    return {
      id: `instant_eval_${nanoid(8)}`,
      projectId: projectId(),
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

  return { runRow, judgment };
}

/** A key bound to a person, which is the only kind the ceiling checks. */
async function createUserKey(
  seeded: SeededProject,
): Promise<{ user: User; token: string }> {
  const user = await prisma.user.create({
    data: { name: "Runner", email: `runner-${nanoid(6)}@example.com` },
  });
  seeded.userIds.push(user.id);
  const { token, lookupId, hashedSecret } = generateApiKeyToken();
  const key = await prisma.apiKey.create({
    data: {
      name: `runner key ${nanoid(6)}`,
      lookupId,
      hashedSecret,
      userId: user.id,
      organizationId: seeded.organization.id,
    },
  });
  seeded.apiKeyIds.push(key.id);
  return { user, token };
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
  flag: { isEnabled: boolean };
  allows?: (permission: string) => boolean;
}) {
  const runs = useFakeRunService({ flag, allows });
  const seeded = useSeededProject();
  const { api, headers } = requestClient(() => seeded.current().apiKey);
  const { runRow, judgment } = rowFactories(() => seeded.current().projectId);

  return {
    api,
    headers,
    runRow,
    judgment,
    createUserKey: () => createUserKey(seeded.current()),
    get runs(): InstantEvalRunServiceFakes {
      return runs.current();
    },
    get projectId(): string {
      return seeded.current().projectId;
    },
  };
}
