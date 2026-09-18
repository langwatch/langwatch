/**
 * The Instant Evals REST family, end to end over the mounted Hono app.
 *
 * The run service is stood up on fakes through `setInstantEvalRunService`, so
 * these exercise the whole request path the framework builds (authentication,
 * the API-key ceiling, the feature gate, validation, the wire mapping and the
 * error envelope) without a ClickHouse, a queue or a classifier. What the
 * service itself decides has its own tests beside it.
 *
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectFactory } from "~/factories/project.factory";
import type {
  InstantEvalRun,
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
import {
  InstantEvalAlreadyFinishedError,
  InstantEvalQueryInvalidError,
  InstantEvalQueryMissingColumnsError,
  InstantEvalRowCapExceededError,
  InstantEvalRunNotFoundError,
} from "~/server/app-layer/instant-evals/run/errors";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { app } from "../[[...route]]/app";

const flagIsOn = vi.hoisted(() => ({ value: true }));

vi.mock("~/server/app-layer/instant-evals/access", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/app-layer/instant-evals/access")
    >();
  return {
    ...original,
    instantEvalsEnabled: async () => flagIsOn.value,
  };
});

const BASE = "/api/v1/instant-evals";

const SQL =
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

describe("Feature: The Instant Eval run over REST", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let testUserIds: string[];
  let testApiKeyIds: string[];
  let runs: {
    create: ReturnType<typeof vi.fn>;
    estimate: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    results: ReturnType<typeof vi.fn>;
    sample: ReturnType<typeof vi.fn>;
  };
  let keyAllows: (permission: string) => boolean;

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
  function runRow(overrides: Partial<InstantEvalRun> = {}): InstantEvalRun {
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
    } as InstantEvalRun;
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
    flagIsOn.value = true;
    keyAllows = () => true;
    globalForApp.__langwatch_app = createTestApp({
      // The ceiling has its own tests. What these need from it is only that a
      // scoped key's declared permission decides whether it reaches the
      // handler, which is what the read-only scenario reads.
      permissions: {
        hasApiKeyPermission: async ({ permission }: { permission: string }) =>
          keyAllows(permission),
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

  // ── creating a run ─────────────────────────────────────────────────────────

  describe("given a statement that projects a trace id and a judged column", () => {
    describe("when it is submitted to the run endpoint", () => {
      /** @scenario "A statement that projects a trace id and a judged column is accepted" */
      it("answers 202 with the queued run, its questions and its statement", async () => {
        runs.create.mockResolvedValue(runRow());

        const res = await api.post(BASE, { sql: SQL });
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body.status).toBe("queued");
        expect(body.sql).toBe(SQL);
        expect(body.questions).toEqual([
          {
            id: "angry",
            function: "eval",
            kind: "boolean",
            reads: "probability",
            threshold: 0.5,
          },
        ]);
        expect(runs.create).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: testProjectId }),
        );
      });

      /** @scenario "A statement the query policy refuses is refused here with the same reason" */
      it("answers 422 naming the policy violations", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalQueryInvalidError({
            reason: "That statement reads a dataset this key may not query.",
            violations: [{ code: "table_not_allowed", table: "secrets" }],
          }),
        );

        const res = await api.post(BASE, { sql: "SELECT * FROM secrets" });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_query_invalid");
        expect(body.meta.violations).toEqual([
          { code: "table_not_allowed", table: "secrets" },
        ]);
      });

      /** @scenario "A statement with no trace id is refused before anything runs" */
      it("answers 422 naming TraceId as the missing column", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalQueryMissingColumnsError({
            missing: ["TraceId"],
            needsEvalFunction: false,
          }),
        );

        const res = await api.post(BASE, {
          sql: "SELECT eval('angry') AS angry FROM traces",
        });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_query_missing_columns");
        expect(body.meta.missing).toEqual(["TraceId"]);
      });

      /** @scenario "A statement with no eval function is refused" */
      it("answers 422 saying an eval function is required", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalQueryMissingColumnsError({
            missing: ["an eval function"],
            needsEvalFunction: true,
          }),
        );

        const res = await api.post(BASE, {
          sql: "SELECT TraceId FROM traces",
        });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_query_missing_columns");
        expect(body.meta.needsEvalFunction).toBe(true);
      });
    });
  });

  // ── caps ───────────────────────────────────────────────────────────────────

  describe("given a project on a plan without the raised cap", () => {
    describe("when a run is requested for fifty thousand rows", () => {
      /** @scenario "A free plan asking past the default cap is refused and told what lifts it" */
      it("answers 422 carrying the cap and the plan", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalRowCapExceededError({
            requested: 50_000,
            cap: 10_000,
            plan: "free",
            maxCap: 100_000,
          }),
        );

        const res = await api.post(BASE, { sql: SQL, limit: 50_000 });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_row_cap_exceeded");
        expect(body.meta).toMatchObject({
          requested: 50_000,
          cap: 10_000,
          plan: "free",
          maxCap: 100_000,
        });
      });
    });
  });

  describe("given a project on a plan with the raised cap", () => {
    describe("when a run is requested for fifty thousand rows", () => {
      /** @scenario "A paid plan may ask up to the raised cap" */
      it("accepts the run with that limit", async () => {
        runs.create.mockResolvedValue(runRow({ rowLimit: 50_000 }));

        const res = await api.post(BASE, { sql: SQL, limit: 50_000 });
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body.limit).toBe(50_000);
        expect(runs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({ limit: 50_000 }),
          }),
        );
      });
    });
  });

  // ── estimating ─────────────────────────────────────────────────────────────

  describe("given a statement matching four hundred rows", () => {
    describe("when an estimate is requested", () => {
      /** @scenario "An estimate counts the rows and prices them without judging any" */
      it("reports the rows, the tokens, the requests, our cost and the price", async () => {
        runs.estimate.mockResolvedValue({
          rows: 400,
          rowsCapped: false,
          avgTokens: 620,
          totalTokens: 248_000,
          requests: 400,
          costUsd: 0.010416,
          priceUsd: 0.013541,
        });

        const res = await api.post(`${BASE}/estimate`, { sql: SQL });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
          rows: 400,
          rowsCapped: false,
          avgTokens: 620,
          totalTokens: 248_000,
          requests: 400,
          costUsd: 0.010416,
          priceUsd: 0.013541,
        });
        // Pricing a run never starts one, so nothing was queued and nothing
        // was judged.
        expect(runs.create).not.toHaveBeenCalled();
      });
    });
  });

  // ── reading a run ──────────────────────────────────────────────────────────

  describe("given a run that judged two pages", () => {
    describe("when it is read", () => {
      /** @scenario "A run reports its progress, its matches per question and what it spent" */
      it("carries the counters and the spend", async () => {
        runs.get.mockResolvedValue(
          runRow({
            status: "RUNNING",
            total: 400,
            progress: 200,
            matched: 37,
            matchedByQuestion: { angry: 37 },
            failed: 2,
            skipped: 1,
            tokens: 124_000,
            costUsd: 0.005208,
            priceUsd: 0.00677,
            startedAt: new Date("2026-09-18T10:00:05.000Z"),
          }),
        );

        const res = await api.get(`${BASE}/instant_eval_abc`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toMatchObject({
          status: "running",
          total: 400,
          progress: 200,
          matched: 37,
          matchedByQuestion: { angry: 37 },
          failed: 2,
          skipped: 1,
          tokens: 124_000,
          costUsd: 0.005208,
          priceUsd: 0.00677,
        });
        // The hydration plan is internal, so it is never published.
        expect(body).not.toHaveProperty("plan");
        expect(body).not.toHaveProperty("rowLimit");
      });
    });
  });

  describe("given two runs in this project and one in another", () => {
    describe("when the runs are listed", () => {
      /** @scenario "Runs are listed newest first and scoped to the credential's project" */
      it("lists only this project's runs, newest first", async () => {
        const newer = runRow({
          id: "instant_eval_newer",
          createdAt: new Date("2026-09-18T12:00:00.000Z"),
        });
        const older = runRow({
          id: "instant_eval_older",
          createdAt: new Date("2026-09-18T09:00:00.000Z"),
        });
        runs.list.mockResolvedValue([newer, older]);

        const res = await api.get(BASE);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.runs.map((run: { id: string }) => run.id)).toEqual([
          "instant_eval_newer",
          "instant_eval_older",
        ]);
        expect(runs.list).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: testProjectId }),
        );
      });
    });
  });

  describe("given a run belonging to another project", () => {
    describe("when it is read with this project's key", () => {
      /** @scenario "A run of another project is not found" */
      it("answers 404 instant_eval_not_found", async () => {
        runs.get.mockRejectedValue(
          new InstantEvalRunNotFoundError({ runId: "instant_eval_elsewhere" }),
        );

        const res = await api.get(`${BASE}/instant_eval_elsewhere`);
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.code).toBe("instant_eval_not_found");
      });
    });
  });

  // ── results and samples ────────────────────────────────────────────────────

  describe("given a run with more judgements than one page carries", () => {
    describe("when the results are read twice with the returned cursor", () => {
      /** @scenario "Results are read page by page with a cursor that never repeats a row" */
      it("answers disjoint pages and no cursor on the last one", async () => {
        const first = [judgment(), judgment()];
        const second = [judgment()];
        runs.results
          .mockResolvedValueOnce({
            judgments: first,
            nextCursor: "cursor-after-page-one",
          })
          .mockResolvedValueOnce({ judgments: second });

        const pageOne = await api.get(
          `${BASE}/instant_eval_abc/results?limit=2`,
        );
        const pageOneBody = await pageOne.json();
        const pageTwo = await api.get(
          `${BASE}/instant_eval_abc/results?limit=2&cursor=${pageOneBody.nextCursor}`,
        );
        const pageTwoBody = await pageTwo.json();

        expect(pageOne.status).toBe(200);
        expect(pageOneBody.nextCursor).toBe("cursor-after-page-one");
        const ids = (body: { judgments: { traceId: string }[] }) =>
          body.judgments.map((one) => one.traceId);
        expect(
          ids(pageOneBody).filter((id) => ids(pageTwoBody).includes(id)),
        ).toEqual([]);
        expect(pageTwoBody.nextCursor).toBeUndefined();
        expect(runs.results).toHaveBeenLastCalledWith(
          expect.objectContaining({ cursor: "cursor-after-page-one" }),
        );
      });
    });
  });

  describe("given a run with two questions", () => {
    describe("when the results are read for one question and matches only", () => {
      /** @scenario "Results can be narrowed to one question and to the matches only" */
      it("answers only that question's passing judgements", async () => {
        runs.results.mockResolvedValue({
          judgments: [judgment({ questionId: "angry", passed: true })],
        });

        const res = await api.get(
          `${BASE}/instant_eval_abc/results?questionId=angry&matched=true`,
        );
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(runs.results).toHaveBeenCalledWith(
          expect.objectContaining({ questionId: "angry", matched: true }),
        );
        for (const one of body.judgments) {
          expect(one.questionId).toBe("angry");
          expect(one.passed).toBe(true);
        }
      });
    });
  });

  describe("given a finished run", () => {
    describe("when a sample of five rows is requested", () => {
      /** @scenario "A sample re-reads the text that was judged without judging it again" */
      it("answers the judged text beside the verdict", async () => {
        const one = judgment({ traceId: "trace-sampled" });
        runs.sample.mockResolvedValue({
          rows: [{ TraceId: "trace-sampled", angry: "I want a refund now" }],
          judgments: [one],
        });

        const res = await api.get(`${BASE}/instant_eval_abc/sample?n=5`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.rows).toEqual([
          { TraceId: "trace-sampled", angry: "I want a refund now" },
        ]);
        expect(body.judgments[0]).toMatchObject({
          traceId: "trace-sampled",
          passed: true,
        });
        expect(runs.sample).toHaveBeenCalledWith(
          expect.objectContaining({ n: 5 }),
        );
        // Reading a sample never starts a run, so nothing was judged again.
        expect(runs.create).not.toHaveBeenCalled();
      });
    });
  });

  // ── cancelling ─────────────────────────────────────────────────────────────

  describe("given a run in progress", () => {
    describe("when it is cancelled", () => {
      /** @scenario "A running run can be cancelled" */
      it("answers the run the cancellation was requested for", async () => {
        runs.cancel.mockResolvedValue(runRow({ status: "RUNNING" }));

        const res = await api.post(`${BASE}/instant_eval_abc/cancel`, {});
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("running");
        expect(runs.cancel).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: testProjectId,
            runId: "instant_eval_abc",
          }),
        );
      });
    });
  });

  describe("given a finished run that is asked to stop", () => {
    describe("when it is cancelled", () => {
      /** @scenario "A finished run cannot be cancelled" */
      it("answers 409 instant_eval_already_finished", async () => {
        runs.cancel.mockRejectedValue(
          new InstantEvalAlreadyFinishedError({
            runId: "instant_eval_abc",
            status: "FINISHED",
          }),
        );

        const res = await api.post(`${BASE}/instant_eval_abc/cancel`, {});
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.code).toBe("instant_eval_already_finished");
      });
    });
  });

  // ── access ─────────────────────────────────────────────────────────────────

  describe("given a project whose Instant Evals flag is off", () => {
    describe("when a run is requested", () => {
      /** @scenario "A project without the flag cannot reach the family" */
      it("answers 403 instant_eval_not_enabled and never reaches the service", async () => {
        flagIsOn.value = false;

        const res = await api.post(BASE, { sql: SQL });
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.code).toBe("instant_eval_not_enabled");
        expect(runs.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a key carrying analytics:view only", () => {
    describe("when a run is requested and then listed", () => {
      /** @scenario "A read-only key cannot create or cancel a run" */
      it("refuses the create and the cancel, and lists runs", async () => {
        const { token } = await createUserKey();
        keyAllows = (permission) => permission === "analytics:view";
        runs.list.mockResolvedValue([]);
        const readOnly = { "X-Project-Id": testProjectId };
        const scopedHeaders = {
          "X-Auth-Token": token,
          "Content-Type": "application/json",
          ...readOnly,
        };

        const created = await app.request(BASE, {
          method: "POST",
          headers: scopedHeaders,
          body: JSON.stringify({ sql: SQL }),
        });
        const cancelled = await app.request(`${BASE}/instant_eval_abc/cancel`, {
          method: "POST",
          headers: scopedHeaders,
          body: "{}",
        });
        const listed = await app.request(BASE, { headers: scopedHeaders });

        expect(created.status).toBe(403);
        expect(cancelled.status).toBe(403);
        expect(listed.status).toBe(200);
        expect(runs.create).not.toHaveBeenCalled();
        expect(runs.cancel).not.toHaveBeenCalled();
      });
    });
  });
});
