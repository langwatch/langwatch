/**
 * The next page of a run, read while the current one is judged, and handed to
 * the intent that asks for it so it is read once.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import type { InstantEvalCancellationChannel } from "../../channels/instant-eval-cancellation.channel.ts";
import type { InstantEvalJudgeChannel } from "../../channels/instant-eval-judge.channel.ts";
import { MemoryInstantEvalRunRepository } from "../../repositories/memory/memory.instant-eval-run.repository.ts";
import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import type {
  InstantEvalKeyPage,
  InstantEvalRowKey,
} from "../../rules/instant-eval-row-keys.rules.ts";
import type { InstantEvalTextSource } from "../instant-eval-estimate.service.ts";
import { InstantEvalJudgePageService } from "../instant-eval-judge-page.service.ts";
import { InstantEvalReadAheadService } from "../instant-eval-read-ahead.service.ts";
import type { InstantEvalRowSourceService } from "../instant-eval-row-source.service.ts";
import { InstantEvalRunContextService } from "../instant-eval-run-context.service.ts";

const PROJECT_ID = "project-1";
const RUN_ID = "run-1";
const AT = Temporal.Instant.from("2026-09-18T10:00:00Z");
const QUESTION = {
  id: "annoyed",
  function: "eval_boolean",
  kind: "boolean",
  reads: "probability",
  question: { id: "annoyed", kind: "boolean", instructions: "was the customer annoyed?" },
};

const FIRST_PAGE = {
  runId: RUN_ID,
  projectId: PROJECT_ID,
  page: 0,
  afterTraceId: null,
  afterSpanId: null,
  pageSize: 2,
  remaining: 10,
  keyColumns: [] as readonly string[],
  deadlineAt: null,
};
const SECOND_PAGE = { ...FIRST_PAGE, page: 1, afterTraceId: "t2", remaining: 8 };

function rowKey(traceId: string): InstantEvalRowKey {
  return { traceId, threadId: "", spanId: "", occurredAt: null };
}

/** A statement of six traces, paged by the cursor the key pass is handed. */
class PagedKeys implements Pick<InstantEvalRowSourceService, "keys"> {
  readonly asked: (string | null)[] = [];
  readonly #traces = ["t1", "t2", "t3", "t4", "t5", "t6"];

  async keys(input: { limit: number; after?: { traceId: string } }): Promise<InstantEvalKeyPage> {
    const after = input.after?.traceId ?? null;
    this.asked.push(after);
    const start = after === null ? 0 : this.#traces.indexOf(after) + 1;
    const keys = this.#traces.slice(start, start + input.limit);

    return { keys: keys.map(rowKey), hasMore: start + input.limit < this.#traces.length };
  }
}

class TextsForTraces implements InstantEvalTextSource {
  readonly asked: string[][] = [];

  async texts(input: { traceIds: readonly string[] }): Promise<readonly Record<string, unknown>[]> {
    this.asked.push([...input.traceIds]);

    return input.traceIds.map((traceId) => ({ TraceId: traceId, annoyed: `text of ${traceId}` }));
  }
}

/** A judge whose answers wait until the test lets them through. */
class GatedJudge implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;
  requests = 0;
  #open: () => void = () => undefined;
  readonly #gate = new Promise<void>((resolve) => {
    this.#open = resolve;
  });

  constructor(private readonly isGated: boolean) {}

  release(): void {
    this.#open();
  }

  async classify(): Promise<InstantEvalJudgement> {
    this.requests += 1;
    if (this.isGated) await this.#gate;

    return {
      verdicts: [{ questionId: "annoyed", probability: 0.9 }],
      inputTokens: 10,
      isTextTruncated: false,
    };
  }
}

class Cancellation implements InstantEvalCancellationChannel {
  isCancelled = false;

  async request(): Promise<void> {
    this.isCancelled = true;
  }

  async isRequested(): Promise<boolean> {
    return this.isCancelled;
  }
}

async function pipeline({
  isGated = false,
  onInsert,
}: { isGated?: boolean; onInsert?: () => void } = {}) {
  const runs = MemoryInstantEvalRunRepository.create(() => AT);
  await runs.write(
    instantEvalRunRow({
      id: RUN_ID,
      projectId: PROJECT_ID,
      questions: [QUESTION],
      plan: [{ column: "annoyed", function: "eval_boolean", options: [] }],
      tokens: 0,
    }),
  );
  const keys = new PagedKeys();
  const texts = new TextsForTraces();
  const judge = new GatedJudge(isGated);
  const cancellation = new Cancellation();
  const readAhead = InstantEvalReadAheadService.create();
  const service = InstantEvalJudgePageService.create({
    context: InstantEvalRunContextService.create({
      runs,
      peers: {
        findProjectCaller: async () => ({ id: PROJECT_ID, lwqlKey: "key-1" }),
        resolveProjectProtections: async () => ({
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
        }),
        isQueryIdentityAvailable: () => true,
      },
    }),
    rowSource: keys,
    textSource: texts,
    judge,
    judgments: {
      insert: async () => {
        onInsert?.();
      },
    },
    cancellation,
    budget: { assertWithinBudget: async () => undefined },
    readAhead,
    now: () => AT.epochMilliseconds,
  });

  return { service, keys, texts, judge, cancellation, readAhead };
}

describe("given a run whose classifier is still busy with a page", () => {
  describe("when the page is being judged", () => {
    /** @scenario "The next page is read while the current one is judged" */
    it("starts reading the next page before this page's judging resolves", async () => {
      const { service, keys, texts, judge } = await pipeline({ isGated: true });

      const judging = service.judgePage(FIRST_PAGE);
      await vi.waitFor(() => expect(judge.requests).toBe(2));
      await vi.waitFor(() => expect(texts.asked).toHaveLength(2));

      expect(keys.asked).toEqual([null, "t2"]);
      expect(texts.asked).toEqual([
        ["t1", "t2"],
        ["t3", "t4"],
      ]);
      judge.release();
      await expect(judging).resolves.toMatchObject({ rows: 2, cursor: "t2", hasNextPage: true });
    });

    /** @scenario "The next page is read while the current one is judged" */
    it("hands the read page to the intent that asks for it, reading it once", async () => {
      const { service, keys, texts } = await pipeline();

      await service.judgePage(FIRST_PAGE);
      const second = await service.judgePage(SECOND_PAGE);

      expect(second).toMatchObject({ rows: 2, cursor: "t4" });
      expect(keys.asked).toEqual([null, "t2", "t4"]);
      expect(texts.asked.filter((traceIds) => traceIds.includes("t3"))).toHaveLength(1);
    });
  });

  describe("when the intent that arrives asks for a different page", () => {
    it("reads that page itself and drops what was read ahead", async () => {
      const { service, keys, readAhead } = await pipeline();

      await service.judgePage(FIRST_PAGE);
      await service.judgePage({ ...SECOND_PAGE, afterTraceId: "t1" });

      expect(keys.asked.slice(0, 3)).toEqual([null, "t2", "t1"]);
      expect(readAhead.size).toBe(1);
    });
  });

  describe("when the run is cancelled between pages", () => {
    it("judges nothing and drops the page read ahead", async () => {
      const { service, judge, cancellation, readAhead } = await pipeline();

      await service.judgePage(FIRST_PAGE);
      const requestsAfterFirst = judge.requests;
      await cancellation.request();
      const outcome = await service.judgePage(SECOND_PAGE);

      expect(outcome).toMatchObject({ rows: 0, hasNextPage: false });
      expect(judge.requests).toBe(requestsAfterFirst);
      expect(readAhead.size).toBe(0);
    });
  });

  describe("when a page fails", () => {
    it("drops the page read ahead so the retry reads for itself", async () => {
      const { service, readAhead } = await pipeline({
        onInsert: () => {
          throw new Error("ClickHouse is down");
        },
      });

      await expect(service.judgePage(FIRST_PAGE)).rejects.toThrow("ClickHouse is down");
      expect(readAhead.size).toBe(0);
    });
  });

  describe("when the run finishes", () => {
    it("drops whatever the run read ahead", async () => {
      const { service, readAhead } = await pipeline();

      await service.judgePage(FIRST_PAGE);
      expect(readAhead.size).toBe(1);
      service.discardReadAhead({ runId: RUN_ID });

      expect(readAhead.size).toBe(0);
    });
  });
});
