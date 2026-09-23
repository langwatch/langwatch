/**
 * `/api/v1/instant-evals` over the real REST runtime and the canonical error
 * envelope, with only `InstantEvalApi` a double: what the boundary parses,
 * hands the application, publishes, and refuses.
 * @see specs/instant-evals/instant-eval-api.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import {
  InstantEvalQueryInvalidError,
  InstantEvalRunNotFoundError,
  instantEvalRestCredential,
  type InstantEvalApi,
  type InstantEvalJudgmentWire,
  type InstantEvalRunWire,
} from "@langwatch/instant-eval-contract";
import { describe, expect, it, vi } from "vitest";

import { instantEvalRest } from "../instant-eval.rest.ts";

const BASE = "http://api.test/api/v1/instant-evals";
const PROJECT_ID = "project-1";
const SQL = "SELECT TraceId, eval('the customer is angry') AS angry FROM traces";

function runWire(overrides: Partial<InstantEvalRunWire> = {}): InstantEvalRunWire {
  return {
    id: "instant_eval_abc",
    name: null,
    sql: SQL,
    parameters: {},
    questions: [
      { id: "angry", function: "eval", kind: "boolean", reads: "probability", threshold: 0.5 },
    ],
    limit: 10_000,
    status: "queued",
    total: null,
    progress: 0,
    matched: 0,
    matchedByQuestion: {},
    failed: 0,
    skipped: 0,
    tokens: 0,
    priceUsd: 0,
    error: null,
    createdAt: "2026-09-18T10:00:00.000Z",
    updatedAt: "2026-09-18T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function judgment(overrides: Partial<InstantEvalJudgmentWire> = {}): InstantEvalJudgmentWire {
  return {
    traceId: "trace-1",
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

function mount(api: Partial<InstantEvalApi>) {
  const stub = createApiFixture<InstantEvalApi>(api);
  const hono = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user" as const, id: "user-1" },
        scope: { tier: "project" as const, id: PROJECT_ID },
      }),
    },
  }).mount(instantEvalRest.router(), {
    app: () => stub,
    credential: "project",
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(instantEvalRestCredential, () => ({ kind: "legacyProjectKey" as const })),
    ],
  });

  return {
    get: (path: string) => hono.request(`${BASE}${path}`),
    post: (path: string, body: unknown) =>
      hono.request(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}

describe("Feature: The Instant Eval run over REST", () => {
  describe("given a statement matching four hundred rows", () => {
    describe("when an estimate is requested", () => {
      it("reports the rows, the tokens, the requests and the price, and starts nothing", async () => {
        const estimate = {
          rows: 400,
          isRowsCapped: false,
          avgTokens: 620,
          totalTokens: 248_000,
          requests: 400,
          priceUsd: 0.013541,
        };
        const createRun = vi.fn<InstantEvalApi["createRun"]>();
        const estimateRun = vi.fn<InstantEvalApi["estimateRun"]>(async () => estimate);
        const api = mount({ estimateRun, createRun });

        const res = await api.post("/estimate", { sql: SQL });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(estimate);
        expect(estimateRun).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: PROJECT_ID, input: { sql: SQL } }),
        );
        expect(createRun).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a run that judged two pages", () => {
    describe("when it is read", () => {
      /** @scenario "A run reports its progress, its matches per question and what it spent" */
      it("carries the counters and the spend, and nothing internal", async () => {
        const api = mount({
          getRun: async () =>
            runWire({
              status: "running",
              total: 400,
              progress: 200,
              matched: 37,
              matchedByQuestion: { angry: 37 },
              failed: 2,
              skipped: 1,
              tokens: 124_000,
              priceUsd: 0.00677,
              startedAt: "2026-09-18T10:00:05.000Z",
            }),
        });

        const res = await api.get("/instant_eval_abc");
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
          priceUsd: 0.00677,
        });
        expect(body).not.toHaveProperty("plan");
        expect(body).not.toHaveProperty("costUsd");
        expect(body).not.toHaveProperty("rowLimit");
      });
    });
  });

  describe("given two runs in this project", () => {
    describe("when the runs are listed", () => {
      it("lists them newest first, for the credential's own project", async () => {
        const findRuns = vi.fn<InstantEvalApi["findRuns"]>(async () => [
          runWire({ id: "instant_eval_newer", createdAt: "2026-09-18T12:00:00.000Z" }),
          runWire({ id: "instant_eval_older", createdAt: "2026-09-18T09:00:00.000Z" }),
        ]);
        const api = mount({ findRuns });

        const res = await api.get("");
        const body = (await res.json()) as { runs: { id: string }[] };

        expect(res.status).toBe(200);
        expect(body.runs.map((run) => run.id)).toEqual([
          "instant_eval_newer",
          "instant_eval_older",
        ]);
        expect(findRuns).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT_ID }));
      });
    });
  });

  describe("given a run belonging to another project", () => {
    describe("when it is read with this project's key", () => {
      it("answers 404 instant_eval_not_found", async () => {
        const api = mount({
          getRun: async () => {
            throw new InstantEvalRunNotFoundError({ runId: "instant_eval_elsewhere" });
          },
        });

        const res = await api.get("/instant_eval_elsewhere");

        expect(res.status).toBe(404);
        expect(((await res.json()) as { code: string }).code).toBe("instant_eval_not_found");
      });
    });
  });

  describe("given a run with more judgements than one page carries", () => {
    describe("when the results are read twice with the returned cursor", () => {
      /** @scenario "Results are read page by page with a cursor that never repeats a row" */
      it("answers disjoint pages and no cursor on the last one", async () => {
        const getResultsPage = vi
          .fn<InstantEvalApi["getResultsPage"]>()
          .mockResolvedValueOnce({
            judgments: [judgment({ traceId: "trace-a" }), judgment({ traceId: "trace-b" })],
            nextCursor: "cursor-after-page-one",
          })
          .mockResolvedValueOnce({ judgments: [judgment({ traceId: "trace-c" })] });
        const api = mount({ getResultsPage });
        type Page = { judgments: { traceId: string }[]; nextCursor?: string };

        const pageOne = await api.get("/instant_eval_abc/results?limit=2");
        const pageOneBody = (await pageOne.json()) as Page;
        const pageTwo = await api.get(
          `/instant_eval_abc/results?limit=2&cursor=${pageOneBody.nextCursor}`,
        );
        const pageTwoBody = (await pageTwo.json()) as Page;

        expect(pageOne.status).toBe(200);
        expect(pageOneBody.nextCursor).toBe("cursor-after-page-one");
        const ids = (page: Page) => page.judgments.map((one) => one.traceId);
        expect(ids(pageOneBody).filter((id) => ids(pageTwoBody).includes(id))).toEqual([]);
        expect(pageTwoBody.nextCursor).toBeUndefined();
        expect(getResultsPage).toHaveBeenLastCalledWith(
          expect.objectContaining({ limit: 2, cursor: "cursor-after-page-one" }),
        );
      });
    });
  });

  describe("given a run with two questions", () => {
    describe("when the results are read for one question and matches only", () => {
      /** @scenario "Results can be narrowed to one question and to the matches only" */
      it("hands the application both narrowings and answers only that question's matches", async () => {
        const getResultsPage = vi.fn<InstantEvalApi["getResultsPage"]>(async () => ({
          judgments: [judgment({ questionId: "angry", passed: true })],
        }));
        const api = mount({ getResultsPage });

        const res = await api.get("/instant_eval_abc/results?questionId=angry&matched=true");
        const body = (await res.json()) as { judgments: InstantEvalJudgmentWire[] };

        expect(res.status).toBe(200);
        expect(getResultsPage).toHaveBeenCalledWith(
          expect.objectContaining({ questionId: "angry", isMatched: true }),
        );
        for (const one of body.judgments) {
          expect(one).toMatchObject({ questionId: "angry", passed: true });
        }
      });
    });
  });

  describe("given a finished run", () => {
    describe("when a sample of five rows is requested", () => {
      /** @scenario "A sample re-reads the text that was judged without judging it again" */
      it("answers the judged text beside the verdict and starts nothing", async () => {
        const createRun = vi.fn<InstantEvalApi["createRun"]>();
        const getSample = vi.fn<InstantEvalApi["getSample"]>(async () => ({
          rows: [{ TraceId: "trace-sampled", angry: "I want a refund now" }],
          judgments: [judgment({ traceId: "trace-sampled" })],
        }));
        const api = mount({ getSample, createRun });

        const res = await api.get("/instant_eval_abc/sample?n=5");
        const body = (await res.json()) as {
          rows: unknown[];
          judgments: InstantEvalJudgmentWire[];
        };

        expect(res.status).toBe(200);
        expect(body.rows).toEqual([{ TraceId: "trace-sampled", angry: "I want a refund now" }]);
        expect(body.judgments[0]).toMatchObject({ traceId: "trace-sampled", passed: true });
        expect(getSample).toHaveBeenCalledWith(expect.objectContaining({ rows: 5 }));
        expect(createRun).not.toHaveBeenCalled();
      });
    });
  });
});

describe("Feature: The Instant Eval shorthand", () => {
  const QUESTION = { id: "annoyed", kind: "boolean", instructions: "The customer sounds annoyed" };

  describe("given a request naming a target and one question", () => {
    describe("when it is submitted to the run endpoint", () => {
      it("hands the application the shorthand and answers 202", async () => {
        const createRun = vi.fn<InstantEvalApi["createRun"]>(async () => runWire());
        const api = mount({ createRun });

        const res = await api.post("", {
          target: "threads",
          filter: "service:checkout",
          start: "2026-09-01T00:00:00.000Z",
          end: "2026-09-08T00:00:00.000Z",
          questions: [QUESTION],
          limit: 500,
        });

        expect(res.status).toBe(202);
        expect(createRun).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              limit: 500,
              shorthand: {
                target: "threads",
                filter: "service:checkout",
                start: "2026-09-01T00:00:00.000Z",
                end: "2026-09-08T00:00:00.000Z",
                questions: [QUESTION],
              },
            },
          }),
        );
      });

      it("reads a question with no kind of its own as a yes or no question", async () => {
        const createRun = vi.fn<InstantEvalApi["createRun"]>(async () => runWire());
        const api = mount({ createRun });

        await api.post("", {
          target: "traces",
          questions: [{ instructions: "The customer sounds annoyed" }],
        });

        expect(createRun).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              shorthand: {
                target: "traces",
                questions: [{ kind: "boolean", instructions: "The customer sounds annoyed" }],
              },
            },
          }),
        );
      });
    });
  });

  describe("given a request carrying both a statement and a target", () => {
    describe("when it is submitted", () => {
      it("answers 422 saying to send one of the two", async () => {
        const api = mount({
          createRun: async () => {
            throw new InstantEvalQueryInvalidError({
              reason:
                "A run takes a statement or a target, not both. Send sql to run a statement you wrote, or target with your questions to have one written for you.",
              fields: ["sql", "target"],
            });
          },
        });

        const res = await api.post("", { sql: SQL, target: "traces", questions: [QUESTION] });
        const body = (await res.json()) as { code: string; meta: { fields: string[] } };

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_query_invalid");
        expect(body.meta.fields).toEqual(["sql", "target"]);
      });
    });
  });

  describe("given a request carrying neither", () => {
    describe("when it is submitted", () => {
      it("hands the application only what was sent, and answers its 422", async () => {
        const createRun = vi.fn<InstantEvalApi["createRun"]>(async () => {
          throw new InstantEvalQueryInvalidError({
            reason:
              "A run needs something to judge: send sql with a statement, or target with the questions to ask of each row.",
            fields: ["sql", "target"],
          });
        });
        const api = mount({ createRun });

        const res = await api.post("", { name: "nothing to judge" });

        expect(res.status).toBe(422);
        expect(createRun).toHaveBeenCalledWith(
          expect.objectContaining({ input: { name: "nothing to judge" } }),
        );
      });
    });
  });

  describe("given a shorthand sent to the estimate endpoint", () => {
    describe("when it is priced", () => {
      /** @scenario "The estimate answers for a shorthand too" */
      it("hands the same shorthand to the estimate", async () => {
        const estimateRun = vi.fn<InstantEvalApi["estimateRun"]>(async () => ({
          rows: 120,
          isRowsCapped: false,
          avgTokens: 900,
          totalTokens: 108_000,
          requests: 120,
          priceUsd: 0.0059,
        }));
        const api = mount({ estimateRun });

        const res = await api.post("/estimate", { target: "traces", questions: [QUESTION] });

        expect(res.status).toBe(200);
        expect(((await res.json()) as { rows: number }).rows).toBe(120);
        expect(estimateRun).toHaveBeenCalledWith(
          expect.objectContaining({
            input: { shorthand: { target: "traces", questions: [QUESTION] } },
          }),
        );
      });
    });
  });
});
